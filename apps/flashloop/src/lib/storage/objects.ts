import "server-only";
import { AuthFailure } from "@/lib/auth/security";
import { recordId } from "@/lib/ownership/store";
import { IMAGE_TYPES, MAX_OBJECT_BYTES } from "./config";

export type ProjectObject = {
  id: string; owner_id: string; project_id: string; job_id: string | null;
  kind: "upload" | "output"; filename: string; content_type: string;
  byte_size: number; status: "pending" | "ready" | "rejected";
  staging_key: string; object_key: string; upload_expires_at: string;
  retention_expires_at: string | null; etag: string | null;
};
export type StoragePolicy = {
  enabled: boolean; upload_url_seconds: number; download_url_seconds: number;
  max_upload_bytes: number; max_account_bytes: number; retention_days: number;
  allowed_content_types: string[];
};

export function storageFailure(error: { code?: string } | null): void {
  if (!error) return;
  if (error.code === "42501") throw new AuthFailure("Object access denied.", 403);
  if (error.code === "P0002") throw new AuthFailure("Not found.", 404);
  if (error.code === "23514" || error.code === "22023") throw new AuthFailure("Upload violates storage policy.", 400);
  if (error.code === "53100" || error.code === "54000") throw new AuthFailure("Account storage limit reached.", 413);
  throw new AuthFailure("Private storage unavailable.", 503);
}

export function uploadFields(body: Record<string, unknown>) {
  if (Object.keys(body).some((key) => !["filename", "content_type", "byte_size"].includes(key)) ||
    typeof body.filename !== "string" || !body.filename.trim() || body.filename.length > 255 || /[\x00-\x1f\x7f]/.test(body.filename) ||
    typeof body.content_type !== "string" || !IMAGE_TYPES.some((type) => type === body.content_type) ||
    typeof body.byte_size !== "number" || !Number.isSafeInteger(body.byte_size) || body.byte_size < 1 || body.byte_size > MAX_OBJECT_BYTES) {
    throw new AuthFailure("Invalid upload. Use JPEG, PNG, or WebP within the configured size limit.", 400);
  }
  return { filename: body.filename.trim(), content_type: body.content_type, byte_size: body.byte_size };
}

/** Validate persisted identities too: privileged writes must never turn a key into a capability. */
export function projectObject(value: unknown): ProjectObject {
  if (!value || typeof value !== "object") throw new AuthFailure("Invalid storage record.", 503);
  const row = value as ProjectObject;
  for (const id of [row.id, row.owner_id, row.project_id]) {
    if (typeof id !== "string" || recordId(id) !== id) throw new AuthFailure("Invalid storage record.", 503);
  }
  const base = `private/owners/${row.owner_id}/projects/${row.project_id}`;
  if (row.staging_key !== `${base}/staging/${row.id}` || row.object_key !== `${base}/objects/${row.id}` ||
    !["upload", "output"].includes(row.kind) || !["pending", "ready", "rejected"].includes(row.status) ||
    !IMAGE_TYPES.some((type) => type === row.content_type) || !Number.isSafeInteger(row.byte_size) ||
    row.byte_size < 1 || row.byte_size > MAX_OBJECT_BYTES || !Number.isFinite(Date.parse(row.upload_expires_at))) {
    throw new AuthFailure("Invalid storage record.", 503);
  }
  return row;
}

export function storagePolicy(value: unknown): StoragePolicy {
  if (!value || typeof value !== "object") throw new AuthFailure("Storage policy is not configured.", 503);
  const policy = value as StoragePolicy;
  if (policy.enabled !== true || !Number.isSafeInteger(policy.upload_url_seconds) || policy.upload_url_seconds < 30 || policy.upload_url_seconds > 900 ||
    !Number.isSafeInteger(policy.download_url_seconds) || policy.download_url_seconds < 1 || policy.download_url_seconds > 900 ||
    !Number.isSafeInteger(policy.max_upload_bytes) || policy.max_upload_bytes < 1 || policy.max_upload_bytes > MAX_OBJECT_BYTES ||
    !Number.isSafeInteger(policy.max_account_bytes) || policy.max_account_bytes < policy.max_upload_bytes * 2 ||
    !Number.isSafeInteger(policy.retention_days) || policy.retention_days < 1 || policy.retention_days > 365 ||
    !Array.isArray(policy.allowed_content_types) || !policy.allowed_content_types.length ||
    policy.allowed_content_types.some((type) => !IMAGE_TYPES.some((allowed) => allowed === type))) {
    throw new AuthFailure("Storage policy is not configured.", 503);
  }
  return policy;
}

export function remainingSeconds(expiresAt: string, maximum: number, now = Date.now()) {
  const seconds = Math.min(maximum, Math.floor((Date.parse(expiresAt) - now) / 1000));
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new AuthFailure("Object access has expired.", 410);
  return seconds;
}
