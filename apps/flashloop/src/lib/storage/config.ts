import "server-only";
import { AuthFailure } from "@/lib/auth/security";

/** Fixed R2 S3 endpoint only. Never accept endpoints, buckets, or keys from requests. */
export function storageConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucket = process.env.R2_PRIVATE_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (process.env.PRIVATE_STORAGE_ENABLED !== "true" || !accountId || !bucket || !accessKeyId || !secretAccessKey ||
    !/^[a-f0-9]{32}$/.test(accountId) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new AuthFailure("Private storage is not configured.", 503);
  }
  return { bucket, endpoint: `https://${accountId}.r2.cloudflarestorage.com`, accessKeyId, secretAccessKey };
}

export const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
