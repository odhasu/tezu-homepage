import "server-only";
import { Inngest } from "inngest";
import { AuthFailure } from "@/lib/auth/security";
import { storageAdminClient } from "./admin";
import { storageConfig } from "./config";
import { createR2Store } from "./r2";
import { newRequestId } from "@/lib/observability/correlation";
import { flushTelemetry, traceOperation } from "@/lib/observability/sentry";

type CleanupEntry = {
  id: string;
  owner_id: string;
  project_id: string;
  staging_key: string;
  object_key: string;
  byte_size: number;
  not_before: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unavailable = () => new AuthFailure("Storage cleanup unavailable.", 503);

/** Queue rows are the only deletion authority; neither events nor request bodies supply keys. */
function cleanupEntry(value: unknown): CleanupEntry {
  if (!value || typeof value !== "object") throw unavailable();
  const entry = value as CleanupEntry;
  if (![entry.id, entry.owner_id, entry.project_id].every((id) => typeof id === "string" && uuid.test(id)) ||
    !Number.isSafeInteger(entry.byte_size) || entry.byte_size < 0 ||
    typeof entry.not_before !== "string" || !Number.isFinite(Date.parse(entry.not_before)) ||
    Date.parse(entry.not_before) > Date.now()) throw unavailable();
  const prefix = `private/owners/${entry.owner_id}/projects/${entry.project_id}`;
  if (entry.staging_key !== `${prefix}/staging/${entry.id}` ||
    entry.object_key !== `${prefix}/objects/${entry.id}`) throw unavailable();
  return entry;
}

/**
 * A crash after deletion and before acknowledgment repeats only idempotent exact-key deletes.
 * Only counts leave this step: object keys and signed URLs never enter Inngest step state.
 */
async function cleanDueObjects(): Promise<{ expired: number; deleted: number }> {
  storageConfig();
  if (process.env.STORAGE_CLEANUP_ENABLED !== "true") throw unavailable();
  const admin = storageAdminClient();
  const expired = await admin.rpc("storage_expire_objects", { p_limit: 100 });
  if (expired.error || !Number.isSafeInteger(expired.data) || expired.data < 0) throw unavailable();
  const batch = await admin.rpc("storage_cleanup_batch", { p_limit: 100 });
  if (batch.error || !Array.isArray(batch.data) || batch.data.length > 100) throw unavailable();
  // Validate the entire batch before any object deletion, including ownership embedded in each key.
  const entries = batch.data.map(cleanupEntry);
  const store = createR2Store();
  let deleted = 0;
  const deadline = Date.now() + 240_000;
  for (const entry of entries) {
    if (Date.now() >= deadline) break;
    try {
      await store.deleteKeys([entry.staging_key, entry.object_key]);
    } catch {
      // Never let provider exception details, endpoints, or credentials enter workflow logs.
      throw unavailable();
    }
    const acknowledged = await admin.rpc("storage_cleanup_done", { p_id: entry.id });
    if (acknowledged.error || typeof acknowledged.data !== "boolean") throw unavailable();
    // Another worker may already have acknowledged this same immutable queue record.
    if (acknowledged.data) deleted++;
  }
  return { expired: expired.data as number, deleted };
}

export async function runStorageCleanup(): Promise<{ expired: number; deleted: number }> {
  try {
    return await traceOperation("storage_cleanup", { requestId: newRequestId() }, cleanDueObjects);
  } catch { throw unavailable(); }
  finally { await flushTelemetry(); }
}

/** Construct lazily, after the HTTP configuration gate, and always require Cloud signatures. */
export function storageCleanupFunctions() {
  const client = new Inngest({
    id: "flashloop-private-storage",
    isDev: false,
    eventKey: process.env.INNGEST_EVENT_KEY,
    signingKey: process.env.INNGEST_SIGNING_KEY,
    // Errors from this module are deliberately generic; no provider payloads are logged.
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const cleanup = client.createFunction({
    id: "private-storage-cleanup",
    triggers: [{ cron: "*/5 * * * *" }],
    retries: 4,
    concurrency: 1,
  }, async ({ step }) => step.run("expire-and-clean-due-objects", runStorageCleanup));
  return { client, functions: [cleanup] };
}
