import "server-only";

import { unwrapWebhook, WebhookVerificationError } from "@whop/sdk/helpers";
import { AuthFailure } from "@/lib/auth/security";
import { requireBillingEnabled } from "./config";
import type { BillingConfig, VerifiedWhopEvent, WhopEventType } from "./types";

export const MAX_WHOP_WEBHOOK_BYTES = 256 * 1024;
const EVENT_TYPES = new Set<WhopEventType>([
  "payment.succeeded", "payment.failed", "payment.requires_action", "membership.activated", "membership.updated",
  "refund.created", "refund.updated", "dispute.created", "dispute.updated", "dispute_alert.created",
]);
const API_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/;

function string(value: unknown, max = 2048): string | null { return typeof value === "string" && value.length > 0 && value.length <= max ? value : null; }
function object(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function validId(value: unknown): string | null { const v = string(value); return v && ID.test(v) ? v : null; }

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => { out[name] = value; });
  return out;
}

/** Verify exact raw Whop Standard Webhooks bytes, then return a minimal safe envelope. */
export function verifyWhopWebhook(input: {
  rawBody: string;
  headers: Headers;
  now?: Date;
  config?: BillingConfig;
}): VerifiedWhopEvent {
  const config = input.config ?? requireBillingEnabled("webhook");
  if (new TextEncoder().encode(input.rawBody).byteLength > MAX_WHOP_WEBHOOK_BYTES) throw new AuthFailure("Webhook payload is too large.", 413);
  const headerId = string(input.headers.get("webhook-id"));
  if (!headerId || !input.headers.get("webhook-timestamp") || !input.headers.get("webhook-signature")) throw new AuthFailure("Invalid billing webhook.", 401);
  let parsed: unknown;
  try {
    parsed = unwrapWebhook<unknown>(input.rawBody, { headers: headerRecord(input.headers), key: config.webhookSecret });
  } catch (error) {
    if (error instanceof WebhookVerificationError || error instanceof Error) throw new AuthFailure("Invalid billing webhook.", 401);
    throw new AuthFailure("Invalid billing webhook.", 401);
  }
  const envelope = object(parsed); const type = string(envelope?.type) as WhopEventType | null;
  const data = object(envelope?.data); const eventId = validId(envelope?.id);
  const accountIdRaw = envelope?.account_id;
  const accountId = accountIdRaw === null || accountIdRaw === undefined ? null : validId(accountIdRaw);
  const apiVersion = string(envelope?.api_version);
  const apiVersionDate = envelope?.api_version_date === null ? null : string(envelope?.api_version_date);
  const eventTimestamp = string(envelope?.timestamp);
  const receivedAt = (input.now ?? new Date()).toISOString();
  if (!eventId || eventId !== headerId || !type || !EVENT_TYPES.has(type) ||
      (accountIdRaw !== null && accountIdRaw !== undefined && !accountId) || (accountId && accountId !== config.accountId) ||
      apiVersion !== "v1" || !apiVersionDate || !API_DATE.test(apiVersionDate) || apiVersionDate !== config.apiVersionDate ||
      !eventTimestamp || !Number.isFinite(Date.parse(eventTimestamp)) || !data) {
    throw new AuthFailure("Invalid billing webhook.", 400);
  }
  const resourceId = validId(data.id);
  const resourcePrefix = type.startsWith("membership.") ? "mem_" : type.startsWith("payment.") ? "pay_" : type.startsWith("refund.") ? "rf_" : type.startsWith("dispute.") ? "dspt_" : "dspa_";
  if (!resourceId?.startsWith(resourcePrefix)) throw new AuthFailure("Invalid billing webhook.", 400);
  return { eventId, type, accountId, apiVersion, apiVersionDate, resourceId, data, receivedAt };
}

/** Keep webhook receipts free of credentials, auth data, addresses, media, and signed URLs. */
export function safeWebhookReceipt(event: VerifiedWhopEvent): Record<string, unknown> {
  const data = object(event.data);
  return {
    eventId: event.eventId, type: event.type, accountId: event.accountId, apiVersion: event.apiVersion,
    apiVersionDate: event.apiVersionDate, resourceId: event.resourceId, receivedAt: event.receivedAt,
    resource: data ? {
      id: validId(data.id), accountId: validId(data.account_id), membershipId: validId(data.membership_id),
      variantId: validId(data.variant_id), productId: validId(data.product_id), status: string(data.status, 80),
      billingReason: string(data.billing_reason, 80), paidAt: string(data.paid_at, 80), updatedAt: string(data.updated_at, 80),
    } : null,
  };
}
