import type { NextRequest } from "next/server";
import { serve } from "inngest/next";
import { authError } from "@/lib/auth/handlers";
import { AuthFailure } from "@/lib/auth/security";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";
import { generationJobFunctions } from "@/lib/generation/inngest";
import { storageCleanupFunctions } from "@/lib/storage/cleanup";
import { storageConfig } from "@/lib/storage/config";
import { billingReconciliationFunctions } from "@/lib/billing/inngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: NextRequest, context: unknown) {
  try {
    requireEdgeOrigin(request);
    const cleanupEnabled = process.env.PRIVATE_STORAGE_ENABLED === "true" && process.env.STORAGE_CLEANUP_ENABLED === "true";
    const jobsEnabled = process.env.GENERATION_JOBS_ENABLED === "true";
    const billingEnabled = process.env.BILLING_RECONCILIATION_ENABLED === "true" && process.env.WHOP_WEBHOOKS_ENABLED === "true";
    if ((!cleanupEnabled && !jobsEnabled && !billingEnabled) || !process.env.INNGEST_SIGNING_KEY?.trim()) {
      throw new AuthFailure("Background jobs are not configured.", 503);
    }
    if (cleanupEnabled) storageConfig();
    const cleanup = cleanupEnabled ? storageCleanupFunctions() : undefined;
    const jobs = jobsEnabled ? generationJobFunctions(cleanup?.client) : undefined;
    const billing = billingEnabled ? billingReconciliationFunctions(jobs?.client ?? cleanup?.client) : undefined;
    // Inngest verifies signatures and timestamps. Database claims/receipts provide
    // permanent idempotency beyond the transport's 24-hour deduplication window.
    const client = jobs?.client ?? cleanup?.client ?? billing?.client;
    const handler = serve({ client: client as never, functions: [...(cleanup?.functions ?? []), ...(jobs?.functions ?? []), ...(billing?.functions ?? [])] });
    const response = await handler(request, context);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Pragma", "no-cache");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) { return authError(error); }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
