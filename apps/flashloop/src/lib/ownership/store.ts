import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertUserDataClient, requireProtectedSession } from "@/lib/auth/server";
import { AuthFailure } from "@/lib/auth/security";

export type Resource = "jobs" | "uploads" | "outputs";
type Table = Resource | "projects" | "accounts";
export type Operation = "list" | "read" | "create" | "update" | "delete";
type Body = Record<string, unknown>;

const columns: Record<Table, string> = {
  accounts: "user_id,display_name,created_at",
  projects: "id,owner_id,name,created_at",
  jobs: "id,project_id,owner_id,label,status,created_at",
  uploads: "id,project_id,owner_id,filename,content_type,byte_size,status,object_key,created_at",
  outputs: "id,project_id,owner_id,job_id,filename,content_type,byte_size,object_key,created_at",
};

export function resourceName(value: string): Resource {
  if (value !== "jobs" && value !== "uploads" && value !== "outputs") {
    throw new AuthFailure("Not found.", 404);
  }
  return value;
}

export function recordId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new AuthFailure("Invalid record ID.", 400);
  }
  return value.toLowerCase();
}

function text(body: Body, key: string, max: number, empty = false): string {
  const value = body[key];
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\u0000")) {
    throw new AuthFailure("Invalid record fields.", 400);
  }
  return value.trim();
}

/** Allowlist input fields. Identity, status, storage keys, and timestamps never come from a user body. */
export function recordFields(table: Table, operation: "create" | "update", body: Body): Body {
  let fields: Body;
  if (table === "accounts") fields = { display_name: text(body, "display_name", 120, true) };
  else if (table === "projects") fields = { name: text(body, "name", 160) };
  else if (table === "jobs") fields = { label: text(body, "label", 160, true) };
  else {
    fields = { filename: text(body, "filename", 255) };
    if (operation === "create") {
      if (table === "outputs") throw new AuthFailure("Output creation is restricted to authorized workers.", 405);
      const contentType = text(body, "content_type", 127);
      const byteSize = body.byte_size;
      if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(contentType) ||
        typeof byteSize !== "number" || !Number.isSafeInteger(byteSize) || byteSize < 0) {
        throw new AuthFailure("Invalid asset metadata.", 400);
      }
      fields = { ...fields, content_type: contentType, byte_size: byteSize };
    }
  }
  if (Object.keys(body).some((key) => !Object.hasOwn(fields, key))) throw new AuthFailure("Unexpected record fields.", 400);
  return fields;
}

function databaseError(error: { code?: string } | null): void {
  if (!error) return;
  if (error.code === "42501") throw new AuthFailure("Record access denied.", 403);
  if (error.code === "23505") throw new AuthFailure("Record already exists.", 409);
  if (error.code === "23503" || error.code === "23514" || error.code?.startsWith("22")) {
    throw new AuthFailure("Invalid record fields.", 400);
  }
  throw new AuthFailure("Project data unavailable.", 503);
}

/**
 * Shared authorization boundary for Route Handlers and future adapters.
 * Supply only a user-scoped client. Every call checks the current Auth user and
 * live verified session; no caller-provided owner ID or cached capability exists.
 * A future MCP adapter must validate its bearer token and use this same boundary.
 */
export function createOwnedStore(client: SupabaseClient) {
  return {
    async execute(table: Table, operation: Operation, options: { projectId?: string; id?: string; body?: Body } = {}) {
      assertUserDataClient(client);
      const context = await requireProtectedSession({ client });
      const ownerId = context.user_id;
      const projectId = options.projectId === undefined ? undefined : recordId(options.projectId);
      const id = options.id === undefined ? undefined : recordId(options.id);
      const child = table === "jobs" || table === "uploads" || table === "outputs";
      if (child) {
        if (!projectId) throw new AuthFailure("Project is required.", 400);
        // Explicit parent authorization supplements the database's RLS and composite FKs.
        const parent = await client.from("projects").select("id").eq("id", projectId).eq("owner_id", ownerId).maybeSingle();
        databaseError(parent.error);
        if (!parent.data) throw new AuthFailure("Not found.", 404);
      }
      if (table === "outputs" && operation === "create") {
        throw new AuthFailure("Output creation is restricted to authorized workers.", 405);
      }
      if (operation === "create") {
        const fields = recordFields(table, "create", options.body ?? {});
        const identity = table === "accounts" ? { user_id: ownerId } : { owner_id: ownerId };
        const result = await client.from(table).insert({ ...fields, ...identity, ...(child ? { project_id: projectId } : {}) })
          .select(columns[table]).single();
        databaseError(result.error);
        return result.data as unknown;
      }
      if ((operation === "read" || operation === "update" || operation === "delete") && table !== "accounts" && !id) {
        throw new AuthFailure("Record ID is required.", 400);
      }
      const query = operation === "update"
        ? client.from(table).update(recordFields(table, "update", options.body ?? {}))
        : operation === "delete" ? client.from(table).delete() : client.from(table).select(columns[table]);
      let scoped = query.eq(table === "accounts" ? "user_id" : "owner_id", ownerId);
      if (child) scoped = scoped.eq("project_id", projectId);
      if (id) scoped = scoped.eq("id", id);
      if (operation === "list") {
        const result = await scoped.order("created_at", { ascending: false }).limit(100);
        databaseError(result.error);
        return result.data as unknown;
      }
      const selected = operation === "update" || operation === "delete" ? scoped.select(columns[table]) : scoped;
      const result = await selected.maybeSingle();
      databaseError(result.error);
      if (!result.data) throw new AuthFailure("Not found.", 404);
      return result.data as unknown;
    },
  };
}
