import "server-only";
import sharp from "sharp";
import { AuthFailure } from "@/lib/auth/security";
import { MAX_OBJECT_BYTES } from "./config";

/** Decode every pixel, not just a filename, MIME claim, or magic prefix. No SVG/HTML/video. */
export async function verifyImage(bytes: Uint8Array, contentType: string, expectedSize: number): Promise<void> {
  if (bytes.byteLength !== expectedSize || expectedSize < 1 || expectedSize > MAX_OBJECT_BYTES) {
    throw new AuthFailure("Uploaded object size does not match its reservation.", 400);
  }
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 40_000_000, animated: false }).timeout({ seconds: 4 });
    const info = await image.metadata();
    const format = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" }[contentType];
    if (!format || info.format !== format || !info.width || !info.height || (info.pages ?? 1) !== 1) throw new Error("Invalid image");
    await image.raw().toBuffer();
  } catch {
    throw new AuthFailure("Uploaded content is not a valid supported image.", 400);
  }
}
