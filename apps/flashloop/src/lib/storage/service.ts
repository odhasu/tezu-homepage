import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertUserDataClient, requireProtectedSession } from "@/lib/auth/server";
import { AuthFailure } from "@/lib/auth/security";
import { recordId } from "@/lib/ownership/store";
import { createR2Store } from "./r2";
import { verifyImage } from "./verify";
import { projectObject, remainingSeconds, storageFailure, storagePolicy, uploadFields, type ProjectObject } from "./objects";

type Clients = { client: SupabaseClient; admin: SupabaseClient };
type R2 = ReturnType<typeof createR2Store>;

export function createPrivateStorageService(clients: Clients, objectStore: () => R2 = createR2Store) {
  async function authorizeProject(projectId: string) {
    assertUserDataClient(clients.client);
    const session = await requireProtectedSession({ client: clients.client });
    const id = recordId(projectId);
    const result = await clients.client.from("projects").select("id").eq("id", id).eq("owner_id", session.user_id).maybeSingle();
    storageFailure(result.error);
    if (!result.data) throw new AuthFailure("Not found.", 404);
    return { projectId: id, ownerId: session.user_id };
  }
  async function owned(projectId: string, objectId: string) {
    const scope = await authorizeProject(projectId);
    const result = await clients.client.from("project_objects").select("*")
      .eq("id", recordId(objectId)).eq("project_id", scope.projectId).eq("owner_id", scope.ownerId).maybeSingle();
    storageFailure(result.error);
    if (!result.data) throw new AuthFailure("Not found.", 404);
    const row = projectObject(result.data);
    if (row.owner_id !== scope.ownerId || row.project_id !== scope.projectId || row.id !== recordId(objectId)) throw new AuthFailure("Not found.", 404);
    return row;
  }
  async function policy() {
    const result = await clients.admin.rpc("storage_policy");
    storageFailure(result.error);
    return storagePolicy(result.data);
  }
  async function remove(projectId: string, objectId: string) {
    await owned(projectId, objectId);
    const result = await clients.client.rpc("delete_project_object", { p_id: recordId(objectId), p_project_id: recordId(projectId) });
    storageFailure(result.error);
    if (result.data !== true) throw new AuthFailure("Not found.", 404);
  }
  return {
    async reserveUpload(projectId: string, body: Record<string, unknown>) {
      const scope = await authorizeProject(projectId);
      const fields = uploadFields(body);
      // Verify provider configuration before consuming a durable reservation.
      const store = objectStore();
      const result = await clients.client.rpc("reserve_project_upload", {
        p_project_id: scope.projectId, p_filename: fields.filename,
        p_content_type: fields.content_type, p_byte_size: fields.byte_size,
      });
      storageFailure(result.error);
      const reservation = result.data as { object?: unknown; policy?: unknown } | null;
      const row = projectObject(reservation?.object);
      const settings = storagePolicy(reservation?.policy);
      if (row.owner_id !== scope.ownerId || row.project_id !== scope.projectId || row.kind !== "upload" || row.status !== "pending") {
        throw new AuthFailure("Invalid storage reservation.", 503);
      }
      // Fresh authorization before issuing each capability, including after reservation.
      await owned(scope.projectId, row.id);
      const seconds = remainingSeconds(row.upload_expires_at, settings.upload_url_seconds);
      const url = await store.uploadUrl(row, seconds);
      return { objectId: row.id, url, method: "PUT", expiresIn: seconds,
        headers: { "Content-Type": row.content_type, "Cache-Control": "private, no-store" },
        byteSize: row.byte_size };
    },
    async completeUpload(projectId: string, objectId: string) {
      const row = await owned(projectId, objectId);
      if (row.kind !== "upload") throw new AuthFailure("Not found.", 404);
      if (row.status === "ready") return { objectId: row.id, status: "ready" };
      if (row.status !== "pending") throw new AuthFailure("Object cannot be completed.", 409);
      const settings = await policy();
      remainingSeconds(row.upload_expires_at, settings.upload_url_seconds);
      const store = objectStore();
      let bytes: Uint8Array;
      try {
        bytes = await store.readStaging(row);
        await verifyImage(bytes, row.content_type, row.byte_size);
      } catch (error) {
        if (error instanceof AuthFailure && [400, 413].includes(error.status)) await remove(projectId, objectId);
        throw error;
      }
      await owned(projectId, objectId);
      // Never begin an R2 write after the reservation's signed-upload deadline.
      // Cleanup waits another 60s; seal has a 15s deadline plus an 8s recovery HEAD.
      remainingSeconds(row.upload_expires_at, settings.upload_url_seconds);
      const etag = await store.seal(row, bytes);
      // Revalidate session and ownership before granting service-only completion.
      await owned(projectId, objectId);
      const result = await clients.admin.rpc("storage_complete_object", {
        p_id: row.id, p_project_id: row.project_id, p_owner_id: row.owner_id, p_etag: etag, p_byte_size: bytes.byteLength,
      });
      storageFailure(result.error);
      const complete = projectObject(result.data);
      if (complete.status !== "ready") throw new AuthFailure("Object verification unavailable.", 503);
      return { objectId: complete.id, status: complete.status };
    },
    async download(projectId: string, objectId: string) {
      const row = await owned(projectId, objectId);
      if (row.status !== "ready" || !row.retention_expires_at || !row.etag) throw new AuthFailure("Object is not ready.", 409);
      const settings = await policy();
      const seconds = remainingSeconds(row.retention_expires_at, settings.download_url_seconds);
      return { objectId: row.id, url: await objectStore().downloadUrl(row, seconds), expiresIn: seconds };
    },
    remove,
    /** Future generation adapters must resolve persisted ready IDs; no URL/key inputs. */
    async requireReadyInputs(projectId: string, objectIds: string[]): Promise<ProjectObject[]> {
      if (!Array.isArray(objectIds) || objectIds.length > 8 || new Set(objectIds).size !== objectIds.length) {
        throw new AuthFailure("Invalid generation inputs.", 400);
      }
      await authorizeProject(projectId);
      const rows: ProjectObject[] = [];
      for (const id of objectIds) {
        const row = await owned(projectId, id);
        if (row.kind !== "upload" || row.status !== "ready" || !row.etag || !row.retention_expires_at) {
          throw new AuthFailure("Generation inputs must be verified uploads.", 409);
        }
        remainingSeconds(row.retention_expires_at, 900);
        rows.push(row);
      }
      return rows;
    },
  };
}
