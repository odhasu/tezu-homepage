const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { Webhook } = require("../node_modules/standardwebhooks");

function load(file, imports, environment) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) { if (name in imports) return imports[name]; return require(name); },
    process: { env: environment }, TextEncoder, TextDecoder, Headers, Request, Response, URL, URLSearchParams, Date, Error, Set, Object, Array, RegExp, JSON, Uint8Array, btoa, Buffer, AbortSignal, fetch,
  });
  return module.exports;
}

const AuthFailure = class extends Error { constructor(message, status = 503) { super(message); this.status = status; } };
const secret = "ws_billing_test_secret";
const config = { accountId: "biz_flashloop", apiVersionDate: "2026-10-28", webhookSecret: secret, environment: "sandbox", origin: "https://flashloop.example", variants: {}, enabled: false, webhooksEnabled: true, fulfillEnabled: false };

function signedEnvelope() {
  const timestamp = new Date();
  const raw = JSON.stringify({ id: "evt_billing_1", type: "payment.succeeded", account_id: config.accountId, api_version: "v1", api_version_date: config.apiVersionDate, timestamp: timestamp.toISOString(), data: { id: "pay_1", status: "paid", membership_id: "mem_1", variant_id: "plan_1" } });
  const id = "evt_billing_1";
  const key = Buffer.from(secret).toString("base64");
  const signature = new Webhook(key).sign(id, timestamp, raw);
  const values = { "webhook-id": id, "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "webhook-signature": signature };
  return { raw, headers: { get(name) { return values[name.toLowerCase()] ?? null; }, forEach(callback) { Object.entries(values).forEach(([name, value]) => callback(value, name)); } } };
}

test("Whop Standard Webhooks helper verifies exact signed bytes", () => {
  const signed = signedEnvelope();
  const helper = require(resolve(__dirname, "../node_modules/@whop/sdk/dist/cjs/helpers/index.js"));
  const parsed = helper.unwrapWebhook(signed.raw, { headers: Object.fromEntries(Object.entries({ "webhook-id": signed.headers.get("webhook-id"), "webhook-timestamp": signed.headers.get("webhook-timestamp"), "webhook-signature": signed.headers.get("webhook-signature") })), key: secret });
  assert.equal(parsed.id, "evt_billing_1"); assert.equal(parsed.data.id, "pay_1");
  assert.throws(() => helper.unwrapWebhook(`${signed.raw}x`, { headers: Object.fromEntries(Object.entries({ "webhook-id": signed.headers.get("webhook-id"), "webhook-timestamp": signed.headers.get("webhook-timestamp"), "webhook-signature": signed.headers.get("webhook-signature") })), key: secret }));
});

test("receipt allowlist drops buyer content and signed URLs", () => {
  const { safeWebhookReceipt } = load("lib/billing/webhooks.ts", {
    "server-only": {}, "@/lib/auth/security": { AuthFailure }, "@whop/sdk/helpers": require(resolve(__dirname, "../node_modules/@whop/sdk/dist/cjs/helpers/index.js")), "./config": { requireBillingEnabled: () => config },
  }, {});
  const receipt = safeWebhookReceipt({ eventId: "evt", type: "payment.succeeded", accountId: config.accountId, apiVersion: "v1", apiVersionDate: config.apiVersionDate, resourceId: "pay_1", receivedAt: new Date().toISOString(), data: { id: "pay_1", customer_email: "private@example.invalid", client_secret: "secret", purchase_url: "https://whop.com/signed", media_url: "https://r2.example/signed" } });
  const serialized = JSON.stringify(receipt); assert.equal(serialized.includes("private@example.invalid"), false); assert.equal(serialized.includes("client_secret"), false); assert.equal(serialized.includes("purchase_url"), false); assert.equal(serialized.includes("r2.example"), false);
});


test("AEAD OAuth state hides verifier and rejects tampering, expiry, and foreign session", () => {
  const { sealWhopOAuthState, unsealWhopOAuthState } = load("lib/billing/oauth.ts", {
    "server-only": {}, "node:crypto": require("node:crypto"), "@/lib/auth/security": { AuthFailure },
    "./config": { billingConfig() { return config; }, BillingConfigurationError: AuthFailure },
  }, { WHOP_OAUTH_STATE_SECRET: "test-only-state-key-".repeat(3) });
  const state = { userId: "a0000000-0000-4000-8000-000000000001", sessionId: "a0000000-0000-4000-8000-000000000002", state: "s".repeat(32), codeVerifier: "v".repeat(43), nonce: "n".repeat(32) };
  const now = Date.now(); const token = sealWhopOAuthState({ ...state, now });
  assert.equal(token.includes(state.codeVerifier), false);
  assert.equal(unsealWhopOAuthState({ token, ...state, now: now + 10 }).state, state.state);
  assert.throws(() => unsealWhopOAuthState({ token: token.slice(0, -2) + "xx", ...state, now }), /invalid|expired/);
  assert.throws(() => unsealWhopOAuthState({ token, ...state, now: now + 600001 }), /invalid|expired/);
  assert.throws(() => unsealWhopOAuthState({ token, ...state, sessionId: "a0000000-0000-4000-8000-000000000003", now }), /invalid|expired/);
});

test("SDK fetch fixes environment, no-store, redirect refusal and bounded response", async () => {
  const provider = load("lib/billing/provider.ts", {
    "server-only": {}, "@whop/sdk": {}, "@/lib/auth/security": { AuthFailure },
    "./config": { BillingConfigurationError: AuthFailure }, "./catalog": {},
  }, {});
  const calls = []; const fetcher = async (url, init) => { calls.push({ url, init }); return Response.json({ ok: true }); };
  const wrapped = provider.whopProviderFetch("sandbox", fetcher);
  const result = await wrapped("https://sandbox-api.whop.com/api/v1/payments/pay_1");
  assert.equal((await result.json()).ok, true); assert.equal(calls[0].init.cache, "no-store"); assert.equal(calls[0].init.redirect, "error");
  await assert.rejects(wrapped("https://api.whop.com/api/v1/payments/pay_1"), /Billing provider unavailable/);
  assert.equal(calls.length, 1);
  await assert.rejects(provider.whopProviderFetch("sandbox", async () => new Response("x".repeat(2097153)))("https://sandbox-api.whop.com/api/v1/payments/pay_1"), /Billing provider unavailable/);
});


test("application verifies actual signed Whop envelope and rejects mismatched IDs, version and replay timestamps", () => {
  const { verifyWhopWebhook } = load("lib/billing/webhooks.ts", {
    "server-only": {}, "@/lib/auth/security": { AuthFailure }, "@whop/sdk/helpers": require(resolve(__dirname, "../node_modules/@whop/sdk/dist/cjs/helpers/index.js")), "./config": { requireBillingEnabled: () => config },
  }, {});
  const signed = signedEnvelope();
  assert.equal(verifyWhopWebhook({ rawBody: signed.raw, headers: signed.headers, config }).resourceId, "pay_1");
  for (const [kind, delta] of [["old", -301000], ["future", 301000]]) {
    const time = new Date(Date.now() + delta); const values = { "webhook-id": "evt_billing_1", "webhook-timestamp": String(Math.floor(time.getTime()/1000)), "webhook-signature": new Webhook(Buffer.from(secret).toString("base64")).sign("evt_billing_1", time, signed.raw) };
    assert.throws(() => verifyWhopWebhook({ rawBody: signed.raw, headers: new Headers(values), config }), /Invalid billing webhook/, kind);
  }
  assert.throws(() => verifyWhopWebhook({ rawBody: signed.raw + "x", headers: signed.headers, config }), /Invalid billing webhook/);
});
