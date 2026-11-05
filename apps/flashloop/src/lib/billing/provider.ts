import "server-only";

import { WhopClient, WhopEnvironment } from "@whop/sdk";
import { AuthFailure } from "@/lib/auth/security";
import { billingConfig, BillingConfigurationError, requireBillingEnabled } from "./config";
import { monthlyPlan } from "./catalog";
import type {
  BillingCheckoutSnapshot, BillingConfig, BillingEnvironment, BillingTier, CheckoutResult, WhopEventType,
  WhopClientLike, WhopMembershipSnapshot, WhopPaymentSnapshot, BillingSnapshot,
} from "./types";

const CHECKOUT_HOSTS = new Set(["whop.com", "www.whop.com", "sandbox.whop.com"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/;

export class WhopProviderError extends AuthFailure {
  constructor(message = "Billing provider unavailable.", status = 503) { super(message, status, 60); }
}

function text(value: unknown): string | null { return typeof value === "string" && value.length <= 2048 ? value : null; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function date(value: unknown): string | null {
  const v = text(value); if (!v) return null;
  const parsed = new Date(v); return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
function id(value: unknown, prefix?: string): string | null {
  const v = text(value); if (!v || !ID.test(v) || (prefix && !v.startsWith(`${prefix}_`))) return null; return v;
}
function safePurchaseUrl(value: unknown): string {
  const raw = text(value); if (!raw) throw new WhopProviderError("Checkout URL unavailable.");
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new WhopProviderError("Checkout URL unavailable."); }
  if (parsed.protocol !== "https:" || !CHECKOUT_HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port || parsed.hash) throw new WhopProviderError("Checkout URL unavailable.");
  return parsed.toString();
}
function moneyMinor(value: unknown): bigint | null {
  const money = record(value); const amount = text(money?.amount); const decimals = money?.decimals;
  if (!amount || amount.startsWith("-") || typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 9 || !/^\d+(?:\.\d+)?$/.test(amount)) return null;
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) return null;
  const digits = `${whole}${fraction.padEnd(decimals, "0")}`;
  try { return BigInt(digits); } catch { return null; }
}
function responseObject(value: unknown): Record<string, unknown> {
  const out = record(value); if (!out) throw new WhopProviderError(); return out;
}

/** SDK network requests carry credentials and private billing data; never cache or follow redirects. */
export function whopProviderFetch(environment: BillingEnvironment, fetcher: typeof fetch = fetch): typeof fetch {
  const origin = environment === "sandbox" ? "https://sandbox-api.whop.com" : "https://api.whop.com";
  return async (input, init) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== origin || !url.pathname.startsWith("/api/v1/") || url.username || url.password || url.hash) throw new Error();
      const signals = [AbortSignal.timeout(5000)];
      if (init?.signal) signals.push(init.signal);
      if (input instanceof Request) signals.push(input.signal);
      const response = await fetcher(input, { ...init, cache: "no-store", next: undefined, redirect: "error", signal: AbortSignal.any(signals) });
      const reader = response.body?.getReader();
      if (!reader) return response;
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2_097_152) { await reader.cancel(); throw new Error(); } chunks.push(chunk.value); }
      } finally { reader.releaseLock(); }
      const headers = new Headers(response.headers); headers.delete("content-length"); headers.delete("content-encoding");
      return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers });
    } catch { throw new WhopProviderError(); }
  };
}
async function providerCall<T>(run: () => PromiseLike<T>): Promise<T> {
  try { return await run(); } catch (error) { if (error instanceof WhopProviderError || error instanceof BillingConfigurationError) throw error; throw new WhopProviderError(); }
}

export function whopClient(config: BillingConfig = billingConfig("reconciliation")): WhopClient {
  const token = process.env.WHOP_API_KEY?.trim();
  if (!token) throw new BillingConfigurationError("Whop API is not configured yet.");
  return new WhopClient({
    token,
    environment: config.environment === "sandbox" ? WhopEnvironment.Sandbox : WhopEnvironment.Production,
    apiVersionDate: config.apiVersionDate,
    timeoutInSeconds: 3,
    maxRetries: 0,
    fetch: whopProviderFetch(config.environment),
    logging: { silent: true },
  });
}

export async function createWhopCheckout(input: {
  tier: BillingTier;
  intentId: string;
  client?: WhopClientLike;
}): Promise<CheckoutResult> {
  if (!ID.test(input.intentId)) throw new WhopProviderError("Checkout intent is invalid.", 400);
  const config = requireBillingEnabled("checkout");
  const client = input.client ?? whopClient(config);
  const variantId = config.variants[input.tier];
  const plan = monthlyPlan(input.tier);
  if (!plan || !variantId) throw new WhopProviderError("Billing plan unavailable.", 400);
  const variant = responseObject(await providerCall(() => client.variants.retrieve({ id: variantId })));
  const due = moneyMinor(variant.initial_price_due);
  const renewal = typeof variant.renewal_price === "number" ? Math.round(variant.renewal_price * 100) : null;
  if (record(variant.account)?.id !== config.accountId || record(variant.product)?.id !== config.productId ||
    variant.id !== variantId || variant.billing_type !== "renewal" || variant.billing_period !== 30 ||
    variant.currency !== "eur" || variant.adaptive_pricing_enabled !== false || variant.allow_multiple_quantity !== false ||
    (variant.trial_period_days !== null && variant.trial_period_days !== 0) || variant.split_pay_required_payments !== null ||
    due !== BigInt(plan.initialPriceCents) || renewal !== plan.renewalPriceCents) throw new WhopProviderError("Whop plan pricing differs from the approved monthly catalog.");
  const result = await providerCall(() => client.checkoutConfigurations.create({
    account_id: config.accountId,
    variant_id: variantId,
    mode: "payment",
    metadata: { flashloop_checkout_intent: input.intentId },
    redirect_url: `${config.origin}/account/billing/complete`,
  }, { idempotencyKey: `flashloop-checkout:${input.intentId}` }));
  const checkout = responseObject(result);
  const checkoutId = id(checkout.id, "ch");
  if (!checkoutId) throw new WhopProviderError("Checkout configuration unavailable.");
  return { id: checkoutId, purchaseUrl: safePurchaseUrl(checkout.purchase_url), tier: input.tier, variantId };
}

export async function retrieveWhopCheckout(input: { id: string; client?: WhopClientLike }): Promise<BillingCheckoutSnapshot> {
  const config = billingConfig("reconciliation");
  const checkoutId = id(input.id, "ch");
  if (!checkoutId) throw new WhopProviderError("Checkout configuration unavailable.", 400);
  const client = input.client ?? whopClient(config);
  const result = await providerCall(() => client.checkoutConfigurations.retrieve({ id: checkoutId }));
  const checkout = responseObject(result);
  if (checkout.id !== checkoutId || checkout.account_id !== config.accountId || checkout.mode !== "payment") throw new WhopProviderError("Checkout configuration unavailable.", 404);
  const metadata = record(checkout.metadata);
  return {
    id: checkoutId, accountId: config.accountId, variantId: id(checkout.variant_id ?? record(checkout.variant)?.id, "plan"),
    metadata, purchaseUrl: checkout.purchase_url ? safePurchaseUrl(checkout.purchase_url) : null,
    redirectUrl: text(checkout.redirect_url),
  };
}

function normalizeMembership(value: unknown, config: BillingConfig): WhopMembershipSnapshot {
  const m = responseObject(value); const account = record(m.account);
  const accountId = id(account?.id, "biz");
  const membershipId = id(m.id, "mem"); const variantId = id(m.variant_id, "plan"); const productId = id(m.product_id, "prod");
  if (!membershipId || !variantId || !productId || accountId !== config.accountId || productId !== config.productId) throw new WhopProviderError("Membership evidence unavailable.");
  const status = text(m.status); if (!status) throw new WhopProviderError("Membership evidence unavailable.");
  const valid = status === "active" || status === "trialing";
  const userId = id(m.user_id, "user");
  const planKey = (Object.entries(config.variants).find(([, id]) => id === variantId)?.[0] ?? null) as BillingTier | null;
  const periodStart = date(m.current_period_start);
  const periodEnd = date(m.current_period_end ?? m.expires_at);
  if (!periodStart || !periodEnd) throw new WhopProviderError("Membership period evidence unavailable.");
  return {
    id: membershipId, accountId, whopUserId: userId, planKey, variantId, planId: variantId, productId, status, valid,
    createdAt: date(m.created_at) ?? (() => { throw new WhopProviderError("Membership evidence unavailable."); })(),
    periodStart, periodEnd,
    cancelAtPeriodEnd: m.cancel_at_period_end === true, manageUrl: m.manage_url ? safePurchaseUrl(m.manage_url) : null,
    checkoutId: null,
  };
}
function normalizePayment(value: unknown, config: BillingConfig): WhopPaymentSnapshot {
  const p = responseObject(value); const paymentId = id(p.id, "pay");
  if (!paymentId || id(p.account_id, "biz") !== config.accountId || p.product_id !== config.productId) throw new WhopProviderError("Payment evidence unavailable.");
  const status = text(p.status) ?? ""; const paid = status === "paid" && Boolean(p.paid_at);
  const refunded = Boolean(p.refunded_at) || moneyMinor(p.refunded_amount) !== null && moneyMinor(p.refunded_amount) !== BigInt(0);
  const billingReason = text(p.billing_reason); const createdAt = date(p.created_at);
  if (!createdAt) throw new WhopProviderError("Payment evidence unavailable.");
  const amountMinor = moneyMinor(p.total ?? p.subtotal);
  const currency = text(p.currency)?.toUpperCase() ?? null;
  const paidAt = date(p.paid_at);
  const membershipId = id(p.membership_id, "mem");
  const variantId = id(p.variant_id, "plan");
  const checkoutId = id(p.checkout_configuration_id, "ch");
  if (paid && (!paidAt || amountMinor === null || !currency || !membershipId || !variantId)) throw new WhopProviderError("Paid payment evidence is incomplete.");
  return {
    id: paymentId, accountId: id(p.account_id, "biz"), status, paid,
    refunded, disputed: Boolean(p.dispute_created_at), billingReason, amountMinor,
    currency, createdAt, paidAt, membershipId, variantId, planId: variantId, checkoutId,
    // The provider exposes membership period, not an invoice period. DB must still verify period bounds.
    periodProven: false,
  };
}

export async function retrieveWhopBillingSnapshot(input: {
  membershipId: string;
  paymentId?: string | null;
  client?: WhopClientLike;
}): Promise<BillingSnapshot> {
  const config = billingConfig("reconciliation");
  const membershipId = id(input.membershipId, "mem"); if (!membershipId) throw new WhopProviderError("Membership evidence unavailable.", 400);
  const client = input.client ?? whopClient(config);
  const membership = normalizeMembership(await providerCall(() => client.memberships.retrieve({ id: membershipId })), config);
  const payment = input.paymentId ? normalizePayment(await providerCall(() => client.payments.retrieve({ id: input.paymentId! })), config) : null;
  if (payment && payment.membershipId && payment.membershipId !== membership.id) throw new WhopProviderError("Billing evidence conflicts.", 409);
  return { environment: config.environment, companyId: config.accountId, whopUserId: membership.whopUserId, observedAt: new Date().toISOString(), membership, payment };
}

export interface WhopActivationEvidence {
  membershipId?: string;
  paymentId?: string;
  periodStart?: string;
  periodEnd?: string;
}

function inside(value: string, start: string, end: string): boolean {
  const t = Date.parse(value); return Number.isFinite(t) && t >= Date.parse(start) && t < Date.parse(end);
}
function samePeriodEvidence(evidence: WhopActivationEvidence | undefined, membership: WhopMembershipSnapshot): boolean {
  return Boolean(evidence && evidence.membershipId === membership.id && date(evidence.periodStart) === membership.periodStart && date(evidence.periodEnd) === membership.periodEnd);
}

/**
 * Reconcile a durable signed receipt from the provider. Raw provider records never
 * leave this adapter. The evidence argument must come from the immutable receipt,
 * never a browser, redirect query, or Inngest event field.
 */
export async function retrieveWhopReceiptSnapshot(input: {
  eventType: WhopEventType;
  resourceId: string;
  evidence?: WhopActivationEvidence;
  client?: WhopClientLike;
}): Promise<BillingSnapshot> {
  const config = billingConfig("reconciliation");
  const client = input.client ?? whopClient(config);
  let membershipId: string | null = null;
  let paymentRaw: unknown = null;
  let refundSucceeded = false;
  let disputed = false;
  if (input.eventType.startsWith("membership.")) {
    membershipId = id(input.resourceId, "mem");
  } else if (input.eventType.startsWith("payment.")) {
    const paymentId = id(input.resourceId, "pay"); if (!paymentId) throw new WhopProviderError("Payment evidence unavailable.", 400);
    paymentRaw = await providerCall(() => client.payments.retrieve({ id: paymentId }));
  } else if (input.eventType.startsWith("refund.")) {
    const refundId = id(input.resourceId, "rf"); if (!refundId) throw new WhopProviderError("Refund evidence unavailable.", 400);
    const refund = responseObject(await providerCall(() => client.refunds.retrieve({ id: refundId })));
    if (refund.id !== refundId || refund.account_id !== config.accountId || !id(refund.payment_id, "pay")) throw new WhopProviderError("Refund evidence unavailable.");
    refundSucceeded = refund.status === "succeeded";
    paymentRaw = await providerCall(() => client.payments.retrieve({ id: refund.payment_id as string }));
  } else if (input.eventType.startsWith("dispute.")) {
    const disputeId = id(input.resourceId, "dspt"); if (!disputeId) throw new WhopProviderError("Dispute evidence unavailable.", 400);
    const dispute = responseObject(await providerCall(() => client.disputes.retrieve({ id: disputeId })));
    const paymentId = id(record(dispute.payment)?.id, "pay");
    if (dispute.id !== disputeId || dispute.account_id !== config.accountId || !paymentId) throw new WhopProviderError("Dispute evidence unavailable.");
    disputed = !["won", "warning_closed"].includes(String(dispute.status));
    paymentRaw = await providerCall(() => client.payments.retrieve({ id: paymentId }));
  } else if (input.eventType === "dispute_alert.created") {
    const alertId = id(input.resourceId, "dspa"); if (!alertId) throw new WhopProviderError("Dispute alert evidence unavailable.", 400);
    const alert = responseObject(await providerCall(() => client.disputeAlerts.retrieve({ id: alertId })));
    const paymentId = id(alert.payment_id, "pay");
    if (alert.id !== alertId || alert.account_id !== config.accountId || !paymentId) throw new WhopProviderError("Dispute alert evidence unavailable.");
    disputed = true; refundSucceeded = alert.auto_refunded === true;
    paymentRaw = await providerCall(() => client.payments.retrieve({ id: paymentId }));
  }
  let payment = paymentRaw ? normalizePayment(paymentRaw, config) : null;
  if (payment) membershipId = payment.membershipId;
  if (!membershipId) throw new WhopProviderError("Membership evidence unavailable.");
  const membership = normalizeMembership(await providerCall(() => client.memberships.retrieve({ id: membershipId! })), config);
  if (membership.id !== membershipId) throw new WhopProviderError("Membership evidence conflicts.", 409);
  if (input.eventType === "membership.activated" && samePeriodEvidence(input.evidence, membership)) {
    const page = await providerCall(() => client.payments.list({
      account_id: config.accountId, membership_id: membership.id, product_id: config.productId,
      variant_id: membership.variantId, created_after: membership.periodStart!, created_before: membership.periodEnd!,
      first: 20, direction: "desc", order: "created_at",
    }));
    if (page.hasNextPage()) throw new WhopProviderError("Billing period requires manual review.", 409);
    const candidates = page.data.map((item) => normalizePayment(item, config)).filter((item) =>
      item.paid && item.membershipId === membership.id && item.variantId === membership.variantId &&
      (item.billingReason === "subscription_create" || item.billingReason === "subscription_cycle") &&
      item.paidAt && inside(item.createdAt, membership.periodStart!, membership.periodEnd!) && inside(item.paidAt, membership.periodStart!, membership.periodEnd!));
    if (candidates.length !== 1) throw new WhopProviderError("Billing period requires reconciliation.");
    paymentRaw = await providerCall(() => client.payments.retrieve({ id: candidates[0].id }));
    payment = normalizePayment(paymentRaw, config);
  }
  if (payment) {
    const buyer = id(record(responseObject(paymentRaw).user)?.id, "user");
    if (payment.membershipId !== membership.id || payment.variantId !== membership.variantId || buyer !== membership.whopUserId) throw new WhopProviderError("Billing buyer evidence conflicts.", 409);
    const activationProven = input.eventType === "membership.activated" && samePeriodEvidence(input.evidence, membership);
    const periodProven = Boolean(activationProven && payment.paid && payment.paidAt &&
      (payment.billingReason === "subscription_create" || payment.billingReason === "subscription_cycle") &&
      inside(payment.createdAt, membership.periodStart!, membership.periodEnd!) && inside(payment.paidAt, membership.periodStart!, membership.periodEnd!));
    payment = { ...payment, periodProven, refunded: payment.refunded || refundSucceeded, disputed: payment.disputed || disputed };
  }
  return { environment: config.environment, companyId: config.accountId, whopUserId: membership.whopUserId, observedAt: new Date().toISOString(), membership, payment };
}
