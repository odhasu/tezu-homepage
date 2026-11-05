import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { privateResponse } from "@/lib/http/cache-policy";
import { authError } from "@/lib/auth/handlers";
import { authClients, requireProtectedSession, rateLimit } from "@/lib/auth/server";
import { AuthFailure, readAuthBody, requireSameOrigin } from "@/lib/auth/security";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";
import { monthlyPlan, type BillingTier } from "./catalog";
import { BillingConfigurationError, requireBillingEnabled } from "./config";
import { createWhopCheckout, retrieveWhopBillingSnapshot, retrieveWhopCheckout, retrieveWhopReceiptSnapshot, WhopProviderError } from "./provider";
import { beginWhopOAuth, exchangeWhopOAuthCode, sealWhopOAuthState, unsealWhopOAuthState } from "./oauth";
import { verifyWhopWebhook } from "./webhooks";

const REQUEST_KEY = /^[A-Za-z0-9._:-]{16,200}$/;
const STATE = /^[A-Za-z0-9._~-]{22,256}$/;
const MAX_WEBHOOK_BYTES = 256 * 1024;

type Clients = Awaited<ReturnType<typeof authClients>>;

function errorResponse(error: unknown): Response {
  if (error instanceof BillingConfigurationError || error instanceof WhopProviderError || error instanceof AuthFailure) return authError(error);
  return authError(new AuthFailure("Billing is unavailable. Try again later.", 503));
}

function databaseError(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "42501" || message.includes("verified session") || message.includes("identity required")) throw new AuthFailure("Billing access denied.", 403);
  if (error.code === "P0002" || message.includes("plan unavailable")) throw new AuthFailure("Billing plan unavailable.", 404);
  if (error.code === "23505" || message.includes("conflict")) throw new AuthFailure("Billing request conflicts with recorded state.", 409);
  throw new AuthFailure("Billing service unavailable.", 503);
}

async function rpc(clients: Clients, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await clients.admin.rpc(name, args);
  databaseError(result.error);
  return result.data;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthFailure("Billing response unavailable.", 503);
  return value as Record<string, unknown>;
}

function requiredUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AuthFailure("Billing session unavailable.", 503);
  return value;
}

function billingJson(value: unknown, status = 200): NextResponse {
  return privateResponse(NextResponse.json(value, { status }));
}

export async function handleBillingGet(request: Request): Promise<Response> {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients(false);
    const context = await requireProtectedSession(clients);
    const value = object(await rpc(clients, "billing_account", { p_user_id: context.user_id, p_session_id: context.session_id }));
    const credits = value.videoCredits;
    if (typeof value.linked !== "boolean" || typeof value.billingEnabled !== "boolean" || typeof value.billingAccess !== "boolean" ||
      typeof value.reviewRequired !== "boolean" || typeof credits !== "number" || !Number.isSafeInteger(credits) || credits < 0) {
      throw new AuthFailure("Billing response unavailable.", 503);
    }
    let subscription: Record<string, unknown> | null = null;
    if (value.subscription !== null) {
      const item = object(value.subscription);
      if (typeof item.planKey !== "string" || !monthlyPlan(item.planKey) || typeof item.status !== "string" ||
        !/^[a-z_]{1,40}$/.test(item.status) || typeof item.periodEnd !== "string" || !Number.isFinite(Date.parse(item.periodEnd)) ||
        typeof item.cancelAtPeriodEnd !== "boolean") throw new AuthFailure("Billing response unavailable.", 503);
      subscription = { tier: item.planKey, status: item.status, periodEnd: new Date(item.periodEnd).toISOString(), cancelAtPeriodEnd: item.cancelAtPeriodEnd };
    }
    return billingJson({ linked: value.linked,
      available: value.billingEnabled === true && value.reviewRequired === false && process.env.BILLING_ENABLED === "true" && process.env.BILLING_FULFILL_ENABLED === "true",
      credits, subscription });
  } catch (error) { return errorResponse(error); }
}

export async function handleBillingLinkPost(request: Request): Promise<Response> {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients();
    requireSameOrigin(request, clients.config.origin);
    const context = await requireProtectedSession(clients);
    await rateLimit(clients, `billing:link:${context.user_id}`);
    const start = beginWhopOAuth();
    await rpc(clients, "billing_begin_link", {
      p_user_id: context.user_id, p_session_id: requiredUuid(context.session_id),
      p_state_hash: createHash("sha256").update(start.state).digest("hex"),
    });
    const sealedState = sealWhopOAuthState({ userId: context.user_id, sessionId: context.session_id, state: start.state, codeVerifier: start.codeVerifier, nonce: start.nonce });
    const response = billingJson({ url: start.authorizationUrl });
    const options = { httpOnly: true, secure: clients.config.origin.startsWith("https:"), sameSite: "lax" as const, path: "/api/billing/oauth/callback", maxAge: 600 };
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "private, no-store");
    response.cookies.set("flashloop_whop_oauth", sealedState, options);
    return response;
  } catch (error) { return errorResponse(error); }
}

export async function handleBillingOAuthCallback(request: Request): Promise<Response> {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients();
    const context = await requireProtectedSession(clients);
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookies = (await import("next/headers")).cookies;
    const store = await cookies();
    const token = store.get("flashloop_whop_oauth")?.value;
    if (!code || !state || !token || !STATE.test(code) || !STATE.test(state)) throw new AuthFailure("Whop sign-in callback is invalid.", 400);
    const sealed = unsealWhopOAuthState({ token, userId: context.user_id, sessionId: context.session_id });
    if (!STATE.test(sealed.state) || state !== sealed.state) throw new AuthFailure("Whop sign-in callback is invalid.", 400);
    const identity = await exchangeWhopOAuthCode({ code, codeVerifier: sealed.codeVerifier, expectedState: sealed.state, state, nonce: sealed.nonce });
    await rpc(clients, "billing_consume_link", { p_user_id: context.user_id, p_session_id: context.session_id, p_state_hash: createHash("sha256").update(sealed.state).digest("hex") });
    await rpc(clients, "billing_bind_identity", { p_user_id: context.user_id, p_session_id: context.session_id, p_whop_user_id: identity.sub });
    const response = NextResponse.redirect(new URL("/account/billing?link=success", clients.config.origin), 303);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set("flashloop_whop_oauth", "", { httpOnly: true, secure: clients.config.origin.startsWith("https:"), sameSite: "lax", path: "/api/billing/oauth/callback", maxAge: 0 });
    return privateResponse(response);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleBillingManagePost(request: Request): Promise<Response> {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients();
    requireSameOrigin(request, clients.config.origin);
    const context = await requireProtectedSession(clients);
    await rateLimit(clients, `billing:manage:${context.user_id}`, 10);
    const account = object(await rpc(clients, "billing_account", { p_user_id: context.user_id, p_session_id: context.session_id }));
    const subscriptionValue = account.subscription;
    if (!subscriptionValue || typeof subscriptionValue !== "object" || Array.isArray(subscriptionValue)) throw new AuthFailure("No active Whop subscription.", 404);
    const subscription = subscriptionValue as Record<string, unknown>;
    if (typeof subscription.membershipId !== "string") throw new AuthFailure("No active Whop subscription.", 404);
    const snapshot = await retrieveWhopBillingSnapshot({ membershipId: subscription.membershipId });
    if (snapshot.whopUserId !== account.whopUserId) throw new AuthFailure("Billing access denied.", 403);
    const manageUrl = snapshot.membership?.manageUrl;
    if (!manageUrl) throw new WhopProviderError("Whop management link unavailable.");
    return billingJson({ url: manageUrl });
  } catch (error) { return errorResponse(error); }
}

export async function handleCheckoutPost(request: Request): Promise<Response> {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients();
    requireSameOrigin(request, clients.config.origin);
    const context = await requireProtectedSession(clients);
    await rateLimit(clients, `checkout:account:${context.user_id}`, 5);
    const config = requireBillingEnabled("checkout");
    const body = await readAuthBody(request);
    const tierValue = body.tier;
    const intentKey = body.intentKey;
    if (typeof tierValue !== "string" || !monthlyPlan(tierValue) || typeof intentKey !== "string" || !REQUEST_KEY.test(intentKey)) throw new AuthFailure("Invalid billing request.", 400);
    const tier = monthlyPlan(tierValue)!.tier as BillingTier;
    const intent = object(await rpc(clients, "billing_begin_checkout", { p_user_id: context.user_id, p_session_id: context.session_id, p_plan_key: tier, p_request_key: intentKey }));
    const intentId = typeof intent.intentId === "string" ? intent.intentId : null;
    if (!intentId) throw new AuthFailure("Billing intent unavailable.", 503);
    const plan = object(intent.plan);
    if (plan.planKey !== tier || plan.planId !== config.variants[tier] || plan.productId !== config.productId) throw new AuthFailure("Billing catalog is unavailable.", 503);
    const checkoutId = typeof intent.providerCheckoutId === "string" ? intent.providerCheckoutId : null;
    if (intent.createAllowed === true) {
      try {
        const checkout = await createWhopCheckout({ tier, intentId });
        await rpc(clients, "billing_finish_checkout", { p_intent_id: intentId, p_provider_checkout_id: checkout.id });
        return billingJson({ url: checkout.purchaseUrl });
      } catch (error) {
        await rpc(clients, "billing_unknown_checkout", { p_intent_id: intentId }).catch(() => undefined);
        throw error;
      }
    }
    if (!checkoutId) throw new AuthFailure("Checkout is awaiting reconciliation. Retry with the same request.", 503, 60);
    const checkout = await retrieveWhopCheckout({ id: checkoutId });
    if (checkout.variantId !== config.variants[tier] || checkout.metadata?.flashloop_checkout_intent !== intentId || !checkout.purchaseUrl) throw new AuthFailure("Billing checkout is unavailable.", 503);
    return billingJson({ url: checkout.purchaseUrl });
  } catch (error) { return errorResponse(error); }
}

async function rawBody(request: Request): Promise<string> {
  if (!request.body) throw new AuthFailure("Invalid billing webhook.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_WEBHOOK_BYTES) { await reader.cancel(); throw new AuthFailure("Webhook payload is too large.", 413); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof AuthFailure) throw error;
    throw new AuthFailure("Invalid billing webhook.", 400);
  } finally { reader.releaseLock(); }
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 && field.length <= 255 ? field : null;
}

export async function handleWhopWebhookPost(request: Request): Promise<Response> {
  let receiptId: string | null = null;
  let clients: Clients | null = null;
  try {
    const raw = await rawBody(request);
    const config = requireBillingEnabled("webhook");
    const event = verifyWhopWebhook({ rawBody: raw, headers: request.headers, config });
    if (!event.resourceId) throw new AuthFailure("Invalid billing webhook.", 400);
    clients = await authClients(false);
    const payloadHash = createHash("sha256").update(raw).digest("hex");
    const data = object(event.data);
    const evidence = event.type === "membership.activated" ? {
      membershipId: event.resourceId,
      paymentId: stringField(data, "payment_id") ?? undefined,
      periodStart: stringField(data, "current_period_start") ?? stringField(data, "period_start") ?? undefined,
      periodEnd: stringField(data, "current_period_end") ?? stringField(data, "period_end") ?? undefined,
    } : {};
    const receipt = object(await rpc(clients, "billing_receive_webhook", {
      p_environment: config.environment, p_event_id: event.eventId, p_event_type: event.type,
      p_resource_id: event.resourceId, p_payload_hash: payloadHash, p_evidence: evidence,
    }));
    receiptId = typeof receipt.receiptId === "string" ? receipt.receiptId : null;
    if (!receiptId) throw new AuthFailure("Billing receipt unavailable.", 503);
    if (receipt.duplicate === true && receipt.disposition === "applied") return billingJson({ ok: true, duplicate: true });
    const snapshot = await retrieveWhopReceiptSnapshot({ eventType: event.type, resourceId: event.resourceId, evidence });
    const payment = snapshot.payment ? { ...snapshot.payment, amountMinor: snapshot.payment.amountMinor === null ? null : snapshot.payment.amountMinor.toString() } : null;
    const membership = snapshot.membership ? { ...snapshot.membership, planKey: snapshot.membership.planKey, planId: snapshot.membership.variantId, productId: snapshot.membership.productId } : null;
    await rpc(clients, "billing_apply_snapshot", {
      p_receipt_id: receiptId,
      p_snapshot: { environment: snapshot.environment, companyId: snapshot.companyId, whopUserId: snapshot.whopUserId, resourceId: event.resourceId, observedAt: snapshot.observedAt, membership, payment },
    });
    return billingJson({ ok: true });
  } catch (error) {
    if (receiptId && clients) await rpc(clients, "billing_defer_receipt", { p_receipt_id: receiptId }).catch(() => undefined);
    return errorResponse(error);
  }
}
