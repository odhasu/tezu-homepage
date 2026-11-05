import "server-only";

import { Inngest } from "inngest";
import { createClient } from "@supabase/supabase-js";
import { boundedProviderFetch } from "@/lib/security/provider-fetch";
import { AuthFailure } from "@/lib/auth/security";
import { billingConfig } from "./config";
import { type WhopActivationEvidence, retrieveWhopReceiptSnapshot } from "./provider";
import type { BillingSnapshot, WhopEventType } from "./types";

type RpcClient = ReturnType<typeof createClient>;
type RpcResult = { data: unknown; error: { message?: string } | null };

function callRpc(client: RpcClient, name: string, args: Record<string, unknown>): Promise<RpcResult> {
  return (client.rpc as unknown as (functionName: string, parameters: Record<string, unknown>) => Promise<RpcResult>)(name, args);
}

function billingAdminClient(): RpcClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) throw new AuthFailure("Billing database is not configured.", 503);
  return createClient(url, secret, { global: { fetch: boundedProviderFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function snapshotPayload(snapshot: BillingSnapshot, resourceId: string) {
  const payment = snapshot.payment ? { ...snapshot.payment, amountMinor: snapshot.payment.amountMinor === null ? null : snapshot.payment.amountMinor.toString() } : null;
  const membership = snapshot.membership ? { ...snapshot.membership, planKey: snapshot.membership.planKey, planId: snapshot.membership.variantId, productId: snapshot.membership.productId } : null;
  return { environment: snapshot.environment, companyId: snapshot.companyId, whopUserId: snapshot.whopUserId, resourceId, observedAt: snapshot.observedAt, membership, payment };
}

function dueRows(value: unknown): Array<{ receiptId: string; eventType: WhopEventType; resourceId: string; evidence: WhopActivationEvidence }> {
  if (!Array.isArray(value)) throw new AuthFailure("Billing receipt queue is unavailable.", 503);
  return value.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const item = row as Record<string, unknown>;
    if (typeof item.receiptId !== "string" || typeof item.eventType !== "string" || typeof item.resourceId !== "string") return [];
    const evidence = item.evidence && typeof item.evidence === "object" && !Array.isArray(item.evidence) ? item.evidence as WhopActivationEvidence : {};
    return [{ receiptId: item.receiptId, eventType: item.eventType as WhopEventType, resourceId: item.resourceId, evidence }];
  });
}

export function billingReconciliationFunctions(existingClient?: Inngest) {
  const client = existingClient ?? new Inngest({
    id: "flashloop-billing",
    isDev: false,
    eventKey: process.env.INNGEST_EVENT_KEY,
    signingKey: process.env.INNGEST_SIGNING_KEY,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const reconcile = client.createFunction({
    id: "billing-reconcile-whop-receipts",
    triggers: [{ cron: "* * * * *" }],
    concurrency: 1,
    retries: 4,
  }, async ({ step }) => {
    const rows = await step.run("load-due-billing-receipts", async () => {
      billingConfig("reconciliation");
      const result = await callRpc(billingAdminClient(), "billing_due_receipts", { p_limit: 20 });
      if (result.error) throw new AuthFailure("Billing receipt queue is unavailable.", 503);
      return dueRows(result.data);
    });
    const results: unknown[] = [];
    for (const row of rows) {
      results.push(await step.run(`reconcile-${row.receiptId}`, async () => {
        const admin = billingAdminClient();
        try {
          const snapshot = await retrieveWhopReceiptSnapshot({ eventType: row.eventType, resourceId: row.resourceId, evidence: row.evidence });
          const applied = await callRpc(admin, "billing_apply_snapshot", { p_receipt_id: row.receiptId, p_snapshot: snapshotPayload(snapshot, row.resourceId) });
          if (applied.error) throw new AuthFailure("Billing snapshot could not be applied.", 503);
          return applied.data;
        } catch {
          await callRpc(admin, "billing_defer_receipt", { p_receipt_id: row.receiptId });
          return { receiptId: row.receiptId, deferred: true };
        }
      }));
    }
    return results;
  });
  return { client, functions: [reconcile] };
}
