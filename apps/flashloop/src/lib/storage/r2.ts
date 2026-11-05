import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { AuthFailure } from "@/lib/auth/security";
import { storageConfig, MAX_OBJECT_BYTES } from "./config";
import { remainingSeconds, type ProjectObject } from "./objects";

export function createR2Store() {
  const config = storageConfig();
  const client = new S3Client({
    region: "auto", endpoint: config.endpoint, forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
  });
  const Bucket = config.bucket;
  return {
    async uploadUrl(row: ProjectObject, seconds: number) {
      const command = new PutObjectCommand({ Bucket, Key: row.staging_key, ContentLength: row.byte_size,
        ContentType: row.content_type, CacheControl: "private, no-store" });
      return getSignedUrl(client, command, { expiresIn: seconds,
        signableHeaders: new Set(["content-type", "content-length", "cache-control"]) });
    },
    async downloadUrl(row: ProjectObject, seconds: number) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: row.object_key,
        ResponseCacheControl: "private, no-store", ResponseContentType: row.content_type,
        ResponseContentDisposition: "attachment" }), { expiresIn: seconds });
    },
    async readStaging(row: ProjectObject) {
      const head = await client.send(new HeadObjectCommand({ Bucket, Key: row.staging_key }), { abortSignal: AbortSignal.timeout(8000) });
      if (head.ContentLength !== row.byte_size || head.ContentType !== row.content_type || !head.ETag) {
        throw new AuthFailure("Uploaded object does not match its reservation.", 400);
      }
      const result = await client.send(new GetObjectCommand({ Bucket, Key: row.staging_key, IfMatch: head.ETag }), { abortSignal: AbortSignal.timeout(15000) });
      const body = result.Body?.transformToWebStream();
      if (!body || result.ContentLength !== row.byte_size || result.ContentType !== row.content_type) {
        await body?.cancel();
        throw new AuthFailure("Uploaded object does not match its reservation.", 400);
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > row.byte_size || size > MAX_OBJECT_BYTES) throw new AuthFailure("Uploaded object is too large.", 413);
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      if (size !== row.byte_size) throw new AuthFailure("Uploaded object is incomplete.", 400);
      return Buffer.concat(chunks, size);
    },
    async seal(row: ProjectObject, body: Uint8Array) {
      const digest = createHash("sha256").update(body).digest("hex");
      remainingSeconds(row.upload_expires_at, 900);
      try {
        const result = await client.send(new PutObjectCommand({ Bucket, Key: row.object_key, Body: body,
          ContentLength: body.byteLength, ContentType: row.content_type, CacheControl: "private, no-store",
          Metadata: { sha256: digest }, ContentDisposition: "attachment", IfNoneMatch: "*" }), { abortSignal: AbortSignal.timeout(15000) });
        if (!result.ETag) throw new AuthFailure("Object verification unavailable.", 503);
        return result.ETag;
      } catch {
        // A timeout may follow a successful immutable write. Recover only the
        // exact server-verified bytes; a replay can never replace a sealed key.
        const existing = await client.send(new HeadObjectCommand({ Bucket, Key: row.object_key }), { abortSignal: AbortSignal.timeout(8000) });
        if (existing.Metadata?.sha256 !== digest || existing.ContentLength !== body.byteLength ||
          existing.ContentType !== row.content_type || !existing.ETag) {
          throw new AuthFailure("Object completion conflicts with existing content.", 409);
        }
        return existing.ETag;
      }
    },
    async deleteKeys(keys: string[]) {
      for (const Key of keys) await client.send(new DeleteObjectCommand({ Bucket, Key }), { abortSignal: AbortSignal.timeout(8000) });
    },
  };
}
