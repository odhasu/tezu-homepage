import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthFailure } from "@/lib/auth/security";
import { createEntitlementService } from "@/lib/entitlements/service";
import { generationAdapter, generationAdaptersReady, type GenerationAdapter } from "./providers";
import { applyVerifiedGenerationCallback, callbackPayloadHash } from "./webhooks";
import { newRequestId, type Correlation } from "@/lib/observability/correlation";
import { flushTelemetry, traceOperation } from "@/lib/observability/sentry";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set(["reserved", "dispatching", "dispatched", "unknown", "committed", "released", "reconciliation_required"]);
const unavailable = () => new AuthFailure("Generation jobs unavailable.", 503);

export type GenerationJobContext = {
  requestId: string;
  userId: string;
  requestKey: string;
  projectId: string;
  jobId: string;
  provider: string;
  status: string;
  providerJobId: string | null;
  providerIdempotencyKey: string;
};

type Database = Pick<SupabaseClient, "rpc">;
type Sender = (event: { id: string; name: string; data: { requestId: string } }) => Promise<unknown>;

export function requireGenerationJobs(): void {
  if (process.env.GENERATION_JOBS_ENABLED !== "true" || !process.env.INNGEST_EVENT_KEY?.trim() ||
    !process.env.INNGEST_SIGNING_KEY?.trim() || !generationAdaptersReady()) throw unavailable();
}

function context(value: unknown): GenerationJobContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable();
  const row = value as GenerationJobContext;
  if (![row.requestId, row.userId, row.projectId, row.jobId].every((id) => typeof id === "string" && uuid.test(id)) ||
    typeof row.requestKey !== "string" || !/^[A-Za-z0-9._:-]{16,200}$/.test(row.requestKey) ||
    typeof row.provider !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(row.provider) ||
    !statuses.has(row.status) || typeof row.providerIdempotencyKey !== "string" ||
    !/^flashloop:[0-9a-f-]{36}$/.test(row.providerIdempotencyKey) ||
    (row.providerJobId !== null && (typeof row.providerJobId !== "string" || !row.providerJobId || row.providerJobId.length > 255))) {
    throw unavailable();
  }
  return row;
}

async function rpc(database: Database, name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const result = await database.rpc(name, args);
    if (result.error) throw unavailable();
    return result.data;
  } catch { throw unavailable(); }
}

/** Events identify only a persisted request. They never authorize ownership or replace provider inputs. */
export function generationRequestId(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new AuthFailure("Invalid generation event.", 400);
  const value = data as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || typeof value.requestId !== "string" || !uuid.test(value.requestId)) {
    throw new AuthFailure("Invalid generation event.", 400);
  }
  return value.requestId.toLowerCase();
}

/** Send before acknowledging. A lost response repeats the same event; PostgreSQL remains the permanent dedupe boundary. */
export async function publishGenerationOutbox(database: Database, send: Sender, now = Date.now()): Promise<{ sent: number }> {
  const result = await rpc(database, "generation_dispatch_batch", { p_limit: 50 });
  if (!Array.isArray(result) || result.length > 50) throw unavailable();
  const entries = result.map(context);
  let sent = 0;
  for (const entry of entries) {
    // A missing adapter must not acknowledge or consume an undispatched reservation.
    generationAdapter(entry.provider);
    const recovery = entry.status === "dispatching" || entry.status === "unknown";
    const id = `generation-${recovery ? "reconcile" : "dispatch"}:${entry.requestId}:${Math.floor(now / 300_000)}`;
    try { await send({ id, name: "flashloop/generation.requested", data: { requestId: entry.requestId } }); }
    catch { throw unavailable(); }
    const acknowledged = await rpc(database, "generation_dispatch_sent", { p_request_id: entry.requestId });
    if (typeof acknowledged !== "boolean") throw unavailable();
    sent++;
  }
  return { sent };
}

/** A restart can repeat this entire step. A paid dispatch still requires the one persisted claim. */
export async function executeGenerationJob(
  admin: SupabaseClient,
  requestId: string,
  adapterFor: (provider: string) => GenerationAdapter = generationAdapter,
): Promise<{ status: string }> {
  const correlation: Correlation = { requestId: newRequestId() };
  try {
    return await traceOperation("generation_job", correlation, () => executePersistedJob(admin, requestId, adapterFor, correlation));
  } finally {
    await flushTelemetry();
  }
}

async function executePersistedJob(
  admin: SupabaseClient,
  requestId: string,
  adapterFor: (provider: string) => GenerationAdapter,
  correlation: Correlation,
): Promise<{ status: string }> {
  if (!uuid.test(requestId)) throw new AuthFailure("Invalid generation event.", 400);
  const value = await rpc(admin, "generation_job_context", { p_request_id: requestId });
  if (value === null) return { status: "not_found" };
  const job = context(value);
  if (job.requestId !== requestId.toLowerCase()) throw unavailable();
  Object.assign(correlation, { generationRequestId: job.requestId, jobId: job.jobId });
  if (["committed", "released", "reconciliation_required"].includes(job.status)) return { status: job.status };
  const provider = adapterFor(job.provider);
  if (provider.id !== job.provider) throw unavailable();

  if (job.status === "dispatching" || job.status === "unknown" || job.status === "dispatched") {
    // Reconciliation is an authoritative read only. No not-found, timeout, or expired
    // provider idempotency window can authorize another paid submission or refund.
    let accepted: Awaited<ReturnType<GenerationAdapter["reconcile"]>>;
    try { accepted = await provider.reconcile({ idempotencyKey: job.providerIdempotencyKey, providerJobId: job.providerJobId }); }
    catch { throw unavailable(); }
    if (!accepted) return { status: "awaiting_reconciliation" };
    if (typeof accepted.providerJobId !== "string" || !/^[^\u0000\r\n]{1,255}$/.test(accepted.providerJobId) ||
      (job.providerJobId !== null && accepted.providerJobId !== job.providerJobId)) throw unavailable();
    const bound = job.status === "dispatched" ? job : context(await rpc(admin, "generation_bind_reconciled_job", {
      p_request_id: job.requestId, p_provider: provider.id, p_provider_job_id: accepted.providerJobId,
    }));
    if (accepted.callback) {
      if (accepted.callback.providerJobId !== accepted.providerJobId) throw unavailable();
      // Use a separate, deterministic receipt identity for authoritative API reads.
      // A callback's raw-body digest is never confused with normalized lookup data.
      const payloadHash = callbackPayloadHash(new TextEncoder().encode(JSON.stringify([
        provider.id, accepted.providerJobId, accepted.callback.outcome, accepted.callback.actualCostMicros,
      ])));
      try {
        const result = await applyVerifiedGenerationCallback({ provider: provider.id, client: admin,
          callback: { ...accepted.callback, eventId: `reconciliation:${payloadHash}` }, payloadHash });
        return { status: result.status };
      } catch { throw unavailable(); }
    }
    return { status: bound.status };
  }

  const service = createEntitlementService({ admin });
  const reservation = await service.dispatchReserved(job.userId, job.requestKey, {
    async dispatch(input) {
      if (input.profile.provider !== provider.id || input.idempotencyKey !== job.providerIdempotencyKey) throw unavailable();
      return provider.dispatch(input);
    },
  });
  // Only a status leaves the durable step. Prompts, profiles, URLs, credentials,
  // callback bodies and provider error details must never enter workflow state.
  return { status: reservation.status };
}
