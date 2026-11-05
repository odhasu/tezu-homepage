import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertUserDataClient, requireProtectedSession } from "@/lib/auth/server";
import { AuthFailure } from "@/lib/auth/security";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_KEY = /^[A-Za-z0-9._:-]{16,200}$/;
const PRICE_KEY = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const statuses = ["reserved", "dispatching", "dispatched", "unknown", "committed", "released", "reconciliation_required"] as const;

export type GenerationReservation = {
  requestId: string;
  requestKey: string;
  reservationId: string;
  projectId: string;
  jobId: string;
  priceKey: string;
  currency: string;
  outcome: "succeeded" | "failed" | "cancelled" | null;
  status: typeof statuses[number];
  creditsReserved: number;
  worstCaseCostMicros: number;
  heldCostMicros: number;
  actualCostMicros: number | null;
  spendDay: string;
  settledDay: string | null;
  providerJobId: string | null;
  providerIdempotencyKey: string;
};

export type ReserveGenerationInput = {
  projectId: string;
  requestKey: string;
  priceKey: string;
  prompt: string;
  label?: string;
};

export type ResolveGenerationInput = {
  userId: string;
  requestKey: string;
  actualCostMicros: number;
  outcome: "succeeded" | "failed" | "cancelled";
};

export type ProviderRequest = { profile: Record<string, unknown>; prompt: string; idempotencyKey: string };
export type GenerationProvider = {
  /** Must honor the fixed stored profile and its configured worst-case bound. */
  dispatch(request: ProviderRequest): Promise<{ providerJobId: string }>;
};

type RpcClient = Pick<SupabaseClient, "rpc">;
type Claim = { reservation: GenerationReservation; dispatchAllowed: boolean; providerRequest?: ProviderRequest };

function validUuid(value: string, name: string): string {
  if (!UUID.test(value)) throw new AuthFailure(`Invalid ${name}.`, 400);
  return value.toLowerCase();
}

function validRequestKey(value: string): string {
  if (!REQUEST_KEY.test(value)) throw new AuthFailure("Invalid request key.", 400);
  return value;
}

function validInput(input: ReserveGenerationInput) {
  validRequestKey(input.requestKey);
  const projectId = validUuid(input.projectId, "project ID");
  if (!PRICE_KEY.test(input.priceKey)) throw new AuthFailure("Invalid price key.", 400);
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 6000 || input.prompt.includes("\u0000")) {
    throw new AuthFailure("Invalid generation prompt.", 400);
  }
  const label = input.label ?? "Video generation";
  if (label.length > 160 || label.includes("\u0000")) throw new AuthFailure("Invalid job label.", 400);
  return { ...input, projectId, label };
}

function validCost(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9_000_000_000_000_000) {
    throw new AuthFailure("Invalid actual cost.", 400);
  }
  return value;
}

function databaseFailure(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "23505") throw new AuthFailure("Generation request conflicts with a recorded request or result.", 409);
  if (message.includes("insufficient video credits")) throw new AuthFailure("Not enough video credits.", 402);
  if (message.includes("spend cap") || message.includes("concurrent job limit")) {
    throw new AuthFailure("Generation quota reached. Try again later.", 429);
  }
  if (message.includes("kill switch")) throw new AuthFailure("Video generation is temporarily disabled.", 503);
  if (message.includes("not configured")) throw new AuthFailure("Generation quota is not configured.", 503);
  if (error.code === "42501") throw new AuthFailure("Generation access denied.", 403);
  if (error.code === "P0002") throw new AuthFailure("Generation request or project not found.", 404);
  if (error.code === "55000") throw new AuthFailure("Generation transition requires reconciliation.", 409);
  if (error.code === "22P02" || error.code === "22023" || error.code === "23514") throw new AuthFailure("Invalid generation request.", 400);
  throw new AuthFailure("Generation service unavailable.", 503);
}

function parseRecord(value: unknown): GenerationReservation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthFailure("Invalid reservation response.", 503);
  const data = value as Record<string, unknown>;
  for (const key of ["requestId", "reservationId", "projectId", "jobId"]) {
    if (typeof data[key] !== "string" || !UUID.test(data[key])) throw new AuthFailure("Invalid reservation response.", 503);
  }
  for (const key of ["creditsReserved", "worstCaseCostMicros", "heldCostMicros"]) {
    if (typeof data[key] !== "number" || !Number.isSafeInteger(data[key]) || data[key] < 0) throw new AuthFailure("Invalid reservation response.", 503);
  }
  if (typeof data.requestKey !== "string" || !REQUEST_KEY.test(data.requestKey) ||
    typeof data.priceKey !== "string" || typeof data.currency !== "string" || !/^[A-Z]{3}$/.test(data.currency) ||
    (data.outcome !== null && !["succeeded", "failed", "cancelled"].includes(String(data.outcome))) ||
    !statuses.some((status) => status === data.status) || typeof data.spendDay !== "string" ||
    (data.settledDay !== null && typeof data.settledDay !== "string") ||
    (data.actualCostMicros !== null && (typeof data.actualCostMicros !== "number" || !Number.isSafeInteger(data.actualCostMicros) || data.actualCostMicros < 0)) ||
    (data.providerJobId !== null && typeof data.providerJobId !== "string") ||
    data.providerIdempotencyKey !== `flashloop:${data.reservationId}`) throw new AuthFailure("Invalid reservation response.", 503);
  // Construct a minimal DTO; worker-only prompt/profile and claim flags never
  // leak through a website reservation response.
  return {
    requestId: data.requestId as string, requestKey: data.requestKey,
    reservationId: data.reservationId as string, projectId: data.projectId as string, jobId: data.jobId as string,
    priceKey: data.priceKey, currency: data.currency, outcome: data.outcome as GenerationReservation["outcome"], status: data.status as GenerationReservation["status"],
    creditsReserved: data.creditsReserved as number, worstCaseCostMicros: data.worstCaseCostMicros as number,
    heldCostMicros: data.heldCostMicros as number, actualCostMicros: data.actualCostMicros as number | null,
    spendDay: data.spendDay, settledDay: data.settledDay as string | null,
    providerJobId: data.providerJobId as string | null, providerIdempotencyKey: data.providerIdempotencyKey as string,
  };
}

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const result = await client.rpc(name, args);
    databaseFailure(result.error);
    return result.data;
  } catch (error) {
    if (error instanceof AuthFailure) throw error;
    // A database timeout can mean committed state. Never retry with another key
    // or issue a compensating refund based on this transport error.
    throw new AuthFailure("Generation outcome is unavailable. Retry with the same request key.", 503);
  }
}

/** Shared, uncached service. Workers must authenticate signed events before use. */
export function createEntitlementService(clients: { user?: SupabaseClient; admin: SupabaseClient }) {
  async function transition(name: string, userId: string, requestKey: string, extra: Record<string, unknown> = {}) {
    return parseRecord(await rpc(clients.admin, name, {
      p_user_id: validUuid(userId, "user ID"), p_request_key: validRequestKey(requestKey), ...extra,
    }));
  }
  async function claim(userId: string, requestKey: string): Promise<Claim> {
    const value = await rpc(clients.admin, "claim_generation", {
      p_user_id: validUuid(userId, "user ID"), p_request_key: validRequestKey(requestKey),
    });
    const reservation = parseRecord(value);
    const data = value as Record<string, unknown>;
    if (typeof data.dispatchAllowed !== "boolean") throw new AuthFailure("Invalid dispatch claim.", 503);
    if (!data.dispatchAllowed) return { reservation, dispatchAllowed: false };
    const provider = data.providerRequest as Record<string, unknown> | undefined;
    if (reservation.status !== "dispatching" || !provider || typeof provider.prompt !== "string" ||
      !provider.profile || typeof provider.profile !== "object" || Array.isArray(provider.profile)) {
      throw new AuthFailure("Invalid dispatch claim.", 503);
    }
    return { reservation, dispatchAllowed: true, providerRequest: {
      profile: provider.profile as Record<string, unknown>, prompt: provider.prompt, idempotencyKey: reservation.providerIdempotencyKey,
    } };
  }
  return {
    async reserveForUser(input: ReserveGenerationInput): Promise<GenerationReservation> {
      if (!clients.user) throw new AuthFailure("User-scoped database client required.", 503);
      assertUserDataClient(clients.user);
      await requireProtectedSession({ client: clients.user });
      const value = validInput(input);
      return parseRecord(await rpc(clients.user, "reserve_generation", {
        p_project_id: value.projectId, p_request_key: value.requestKey, p_price_key: value.priceKey,
        p_prompt: value.prompt, p_label: value.label,
      }));
    },

    async reserveForWorker(userId: string, verifiedSessionId: string, input: ReserveGenerationInput): Promise<GenerationReservation> {
      const value = validInput(input);
      return parseRecord(await rpc(clients.admin, "reserve_generation_for_user", {
        p_user_id: validUuid(userId, "user ID"), p_session_id: validUuid(verifiedSessionId, "session ID"),
        p_project_id: value.projectId, p_request_key: value.requestKey, p_price_key: value.priceKey,
        p_prompt: value.prompt, p_label: value.label,
      }));
    },

    /** Inngest may retry this boundary; only the single persisted claim may send. */
    async dispatchReserved(userId: string, requestKey: string, provider: GenerationProvider): Promise<GenerationReservation> {
      const result = await claim(userId, requestKey);
      if (!result.dispatchAllowed || !result.providerRequest) return result.reservation;
      try {
        const accepted = await provider.dispatch(result.providerRequest);
        if (!accepted.providerJobId || accepted.providerJobId.length > 255 || accepted.providerJobId.includes("\u0000")) {
          throw new Error("Invalid provider acceptance");
        }
        return await transition("mark_generation_dispatched", userId, requestKey, { p_provider_job_id: accepted.providerJobId });
      } catch {
        // Provider acceptance and a lost response are indistinguishable here.
        // If this write also fails, the durable dispatching claim still holds.
        try { await transition("mark_generation_unknown", userId, requestKey); } catch { /* Keep the claim and all funds. */ }
        throw new AuthFailure("Provider outcome is unknown and remains reserved for reconciliation.", 503);
      }
    },

    markUnknown: (userId: string, requestKey: string) => transition("mark_generation_unknown", userId, requestKey),
    resolve: (input: ResolveGenerationInput) => transition("resolve_generation", input.userId, input.requestKey, { p_actual_cost_micros: validCost(input.actualCostMicros), p_outcome: input.outcome }),
    reconcile: (input: ResolveGenerationInput) => transition("reconcile_generation", input.userId, input.requestKey, { p_actual_cost_micros: validCost(input.actualCostMicros), p_outcome: input.outcome }),
    release: (userId: string, requestKey: string) => transition("release_generation", userId, requestKey),
  };
}

export type EntitlementService = ReturnType<typeof createEntitlementService>;
