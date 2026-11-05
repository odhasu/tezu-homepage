import "server-only";

import type { ProviderRequest } from "@/lib/entitlements/service";
import { AuthFailure } from "@/lib/auth/security";

export type GenerationOutcome = "running" | "succeeded" | "failed" | "cancelled";

export type VerifiedGenerationCallback = {
  /** Provider event identifier. Database enforces uniqueness for replay safety. */
  eventId: string;
  providerJobId: string;
  outcome: GenerationOutcome;
  actualCostMicros: number | null;
  /** Provider adapter has authenticated and freshness-checked this timestamp. */
  timestamp: Date;
};

/**
 * Provider adapters are intentionally the only place where provider signing
 * schemes may be implemented. No adapter is registered until its signature,
 * timestamp tolerance, replay, and idempotency guarantees are documented and
 * tested against that provider's current documentation.
 */
export type GenerationAdapter = {
  id: string;
  dispatch(request: ProviderRequest): Promise<{ providerJobId: string }>;
  verifyCallback(input: { rawBody: Uint8Array; headers: Headers; now: Date }): Promise<VerifiedGenerationCallback>;
  reconcile(input: { idempotencyKey: string; providerJobId: string | null }): Promise<{ providerJobId: string; callback?: VerifiedGenerationCallback } | null>;
};

/** Alias used by the reservation service and future workers. */
export type GenerationProvider = GenerationAdapter;

// Deliberately empty. Adding a provider requires explicit setup and review.
const generationAdapters = new Map<string, GenerationAdapter>();

export function generationAdaptersReady(): boolean {
  return false;
}

export function getGenerationProvider(id: string): GenerationAdapter | undefined {
  return generationAdapters.get(id);
}

/** Resolve only configured providers. Unknown and unconfigured providers fail closed. */
export function generationAdapter(id: string): GenerationAdapter {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) {
    throw new AuthFailure("Generation provider is unavailable.", 503);
  }
  const adapter = getGenerationProvider(id);
  if (!adapter) throw new AuthFailure("Generation provider is unavailable.", 503);
  return adapter;
}
