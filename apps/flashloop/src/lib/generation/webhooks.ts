import "server-only";

import { createHash } from "node:crypto";
import { AuthFailure } from "@/lib/auth/security";
import type { GenerationAdapter, VerifiedGenerationCallback } from "./providers";

export const MAX_CALLBACK_BYTES = 64 * 1024;

type CallbackResult = {
  applied: boolean;
  duplicate: boolean;
  status: string;
  requestId: string | null;
  jobId: string | null;
};

type CallbackClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string } | null;
  }>;
};

const EVENT_ID = /^[A-Za-z0-9._:-]{1,255}$/;
const PROVIDER_JOB_ID = /^[^\u0000\r\n]{1,255}$/;
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_COST_MICROS = 9_000_000_000_000_000;

function databaseError(error: { code?: string; message?: string } | null): never {
  if (error?.code === "P0002") throw new AuthFailure("Generation job not found.", 404);
  if (error?.code === "23505") throw new AuthFailure("Generation callback conflicts with a recorded event.", 409);
  throw new AuthFailure("Generation callback unavailable.", 503);
}

function validatedCallback(value: VerifiedGenerationCallback): VerifiedGenerationCallback {
  if (!value || typeof value !== "object" || typeof value.eventId !== "string" || !EVENT_ID.test(value.eventId) ||
    typeof value.providerJobId !== "string" || !PROVIDER_JOB_ID.test(value.providerJobId) ||
    !["running", "succeeded", "failed", "cancelled"].includes(value.outcome) ||
    !(value.timestamp instanceof Date) || !Number.isFinite(value.timestamp.getTime()) ||
    (value.outcome === "running" && value.actualCostMicros !== null) ||
    (value.outcome !== "running" &&
      (!Number.isSafeInteger(value.actualCostMicros) || (value.actualCostMicros as number) < 0 || (value.actualCostMicros as number) > MAX_COST_MICROS))) {
    throw new AuthFailure("Invalid generation callback.", 400);
  }
  return value;
}

export function callbackPayloadHash(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

function validPayloadHash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new AuthFailure("Generation callback unavailable.", 503);
  return value;
}

/** Apply already verified provider evidence through one atomic database RPC. */
export async function applyVerifiedGenerationCallback(input: {
  provider: string;
  client: CallbackClient;
  callback: VerifiedGenerationCallback;
  payloadHash: string;
}): Promise<CallbackResult> {
  if (typeof input.provider !== "string" || !PROVIDER_ID.test(input.provider)) {
    throw new AuthFailure("Generation callback unavailable.", 503);
  }
  const verified = validatedCallback(input.callback);
  const result = await input.client.rpc("apply_generation_callback", {
    p_provider: input.provider,
    p_event_id: verified.eventId,
    p_provider_job_id: verified.providerJobId,
    p_outcome: verified.outcome,
    p_actual_cost_micros: verified.actualCostMicros,
    p_payload_hash: validPayloadHash(input.payloadHash),
  });
  if (result.error) databaseError(result.error);
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    throw new AuthFailure("Generation callback unavailable.", 503);
  }
  const data = result.data as Record<string, unknown>;
  if (typeof data.applied !== "boolean" || typeof data.duplicate !== "boolean" || typeof data.status !== "string" ||
    (data.requestId !== null && typeof data.requestId !== "string") || (data.jobId !== null && typeof data.jobId !== "string")) {
    throw new AuthFailure("Generation callback unavailable.", 503);
  }
  return {
    applied: data.applied,
    duplicate: data.duplicate,
    status: data.status,
    requestId: data.requestId as string | null,
    jobId: data.jobId as string | null,
  };
}

/**
 * Verify provider callback before touching database. Provider adapters own all
 * signature, timestamp, and provider replay checks; this layer only validates
 * the trusted result shape and atomically applies it through one RPC.
 */
export async function applyGenerationCallback(input: {
  provider: string;
  adapter: GenerationAdapter;
  client: CallbackClient;
  rawBody: Uint8Array;
  headers: Headers;
  now?: Date;
}): Promise<CallbackResult> {
  if (input.rawBody.byteLength > MAX_CALLBACK_BYTES) throw new AuthFailure("Generation callback is too large.", 413);
  if (input.adapter.id !== input.provider || !PROVIDER_ID.test(input.provider)) {
    throw new AuthFailure("Generation callback unavailable.", 503);
  }
  const verified = validatedCallback(await input.adapter.verifyCallback({
    rawBody: input.rawBody,
    headers: input.headers,
    now: input.now ?? new Date(),
  }));
  return applyVerifiedGenerationCallback({
    provider: input.provider,
    client: input.client,
    callback: verified,
    payloadHash: callbackPayloadHash(input.rawBody),
  });
}
