import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { AuthFailure } from "@/lib/auth/security";

export const EDGE_PROOF_HEADER = "x-flashloop-edge-key";

/** Vercel deployments cannot opt out. Local integration tests may opt in explicitly. */
export function edgeProtectionRequired(): boolean {
  return process.env.VERCEL === "1" || process.env.EDGE_PROTECTION_REQUIRED === "true";
}

/** Network provenance only. Every handler must still authorize the live user/session. */
export function requireEdgeOrigin(request: Pick<Request, "headers">): void {
  if (!edgeProtectionRequired()) return;
  const secret = process.env.EDGE_ORIGIN_SECRET;
  let origin: URL;
  try {
    origin = new URL(process.env.AUTH_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.origin !== process.env.AUTH_ORIGIN ||
      origin.port || origin.hostname.endsWith(".vercel.app") ||
      origin.hostname === "vercel.app" || origin.hostname === "localhost" ||
      isIP(origin.hostname) || !origin.hostname.includes(".") ||
      !secret || secret.length < 32 || secret.length > 256 || secret.trim() !== secret) {
      throw new Error("Invalid edge configuration");
    }
  } catch {
    throw new AuthFailure("Edge protection is not configured.", 503);
  }
  const proof = request.headers.get(EDGE_PROOF_HEADER);
  if (request.headers.get("host") !== origin.host || !proof || proof.length > 256 ||
    !timingSafeEqual(createHash("sha256").update(proof).digest(), createHash("sha256").update(secret!).digest())) {
    throw new AuthFailure("Request must use the protected domain.", 403);
  }
}

/** Cloudflare overwrites CF-Connecting-IP. It is trustworthy only after origin proof. */
export function trustedClientIp(request: Pick<Request, "headers">): string {
  if (!edgeProtectionRequired()) return "local";
  requireEdgeOrigin(request);
  const value = request.headers.get("cf-connecting-ip");
  if (!value || !isIP(value)) throw new AuthFailure("Client network could not be verified.", 403);
  // Normalize IPv6 spelling before hashing so alternate text forms cannot split counters.
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname : value;
}
