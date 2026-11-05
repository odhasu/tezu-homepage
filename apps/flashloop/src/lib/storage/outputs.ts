import "server-only";
import { AuthFailure } from "@/lib/auth/security";
import { recordId } from "@/lib/ownership/store";
import { fetchProviderOutput } from "@/lib/security/provider-destinations";
import { storageAdminClient } from "./admin";
import { storageConfig } from "./config";
import { projectObject, remainingSeconds, storageFailure, storagePolicy, uploadFields } from "./objects";
import { createR2Store } from "./r2";
import { verifyImage } from "./verify";

/**
 * Server-only building block for a future signature-verified generation worker.
 * No callback or public output-ingestion endpoint exists. Resolve owner/project
 * from the persisted job, never a callback's asserted account or object key.
 */
export async function storeGeneratedImage(jobId: string, providerUrl: string, filename: string) {
  storageConfig();
  const admin = storageAdminClient();
  const job = await admin.from("jobs").select("id,owner_id,project_id,status").eq("id", recordId(jobId)).maybeSingle();
  storageFailure(job.error);
  if (!job.data || job.data.status !== "running") throw new AuthFailure("Output job is not authorized.", 403);
  const settings = await admin.rpc("storage_policy");
  storageFailure(settings.error);
  const policy = storagePolicy(settings.data);
  const download = await fetchProviderOutput(providerUrl, { maxBytes: policy.max_upload_bytes });
  const fields = uploadFields({ filename, content_type: download.contentType.split(";")[0].trim().toLowerCase(), byte_size: download.byteSize });
  if (!policy.allowed_content_types.includes(fields.content_type)) throw new AuthFailure("Output type is not permitted.", 400);
  await verifyImage(download.body, fields.content_type, fields.byte_size);
  const reserved = await admin.rpc("storage_reserve_output", {
    p_job_id: job.data.id, p_project_id: job.data.project_id, p_owner_id: job.data.owner_id,
    p_filename: fields.filename, p_content_type: fields.content_type, p_byte_size: fields.byte_size,
  });
  storageFailure(reserved.error);
  const row = projectObject((reserved.data as { object?: unknown } | null)?.object);
  if (row.kind !== "output" || row.job_id !== job.data.id || row.project_id !== job.data.project_id || row.owner_id !== job.data.owner_id) {
    throw new AuthFailure("Invalid output reservation.", 503);
  }
  remainingSeconds(row.upload_expires_at, policy.upload_url_seconds);
  const etag = await createR2Store().seal(row, download.body);
  const completed = await admin.rpc("storage_complete_object", {
    p_id: row.id, p_project_id: row.project_id, p_owner_id: row.owner_id, p_etag: etag, p_byte_size: download.byteSize,
  });
  storageFailure(completed.error);
  const result = projectObject(completed.data);
  if (result.status !== "ready") throw new AuthFailure("Output completion unavailable.", 503);
  return { objectId: result.id, projectId: result.project_id };
}
