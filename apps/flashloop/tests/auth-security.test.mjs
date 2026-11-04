import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthFailure, parseAuthContext, readAuthBody, readCredentials, requireSameOrigin, requireVerified, verifyTurnstile } from "../src/lib/auth/security.ts";

const now = Date.now();
const config = { secret: "test-secret", hostname: "kumi-staging.vercel.app" };
const valid = { success: true, hostname: config.hostname, action: "signup", challenge_ts: new Date(now).toISOString() };
const reply = (value = valid, status = 200) => async () => Response.json(value, { status });

test("fresh challenge passes with exact hostname and action", async () => {
  await verifyTurnstile("fresh", "signup", config, reply(), now);
});

for (const [name, token] of [["missing", undefined], ["empty", ""], ["non-string", {}], ["oversized", "x".repeat(2049)]]) {
  test(`${name} token rejected without provider call`, async () => {
    await assert.rejects(verifyTurnstile(token, "signup", config, async () => { assert.fail("Provider must not be called"); }, now), AuthFailure);
  });
}

for (const [name, change] of [
  ["invalid", { success: false }], ["truthy non-boolean success", { success: "true" }],
  ["wrong hostname", { hostname: "attacker.example" }], ["hostname suffix", { hostname: `${config.hostname}.attacker.example` }],
  ["wrong action", { action: "signin" }], ["missing action", { action: undefined }],
  ["missing timestamp", { challenge_ts: undefined }], ["invalid timestamp", { challenge_ts: "invalid" }],
  ["expired", { challenge_ts: new Date(now - 300_000).toISOString() }],
  ["future timestamp", { challenge_ts: new Date(now + 31_000).toISOString() }],
]) {
  test(`${name} provider response rejected`, async () => {
    await assert.rejects(verifyTurnstile("token", "signup", config, reply({ ...valid, ...change }), now), AuthFailure);
  });
}

test("replayed token rejected by provider single-use result", async () => {
  let consumed = false;
  const singleUse = async () => {
    if (consumed) return Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] });
    consumed = true;
    return Response.json(valid);
  };
  await verifyTurnstile("same-token", "signup", config, singleUse, now);
  await assert.rejects(verifyTurnstile("same-token", "signup", config, singleUse, now), AuthFailure);
});

for (const [name, fetcher] of [
  ["network failure", async () => { throw new Error("offline"); }],
  ["provider error", reply(valid, 500)],
  ["invalid JSON", async () => new Response("not JSON")],
  ["null response", reply(null)],
]) test(`${name} fails closed`, async () => {
  await assert.rejects(verifyTurnstile("token", "signup", config, fetcher, now), AuthFailure);
});

const origin = "https://kumi-staging.vercel.app";
const headers = { origin, "content-type": "application/json", "x-requested-with": "flashloop", "sec-fetch-site": "same-origin" };
test("same-origin JSON allowed", () => requireSameOrigin(new Request(origin, { headers }), origin));
for (const [name, change] of [["cross-origin", { origin: "https://attacker.example" }], ["null origin", { origin: "null" }],
  ["cross-site fetch", { "sec-fetch-site": "cross-site" }], ["form content", { "content-type": "text/plain" }],
  ["missing custom header", { "x-requested-with": "" }], ["missing origin", { origin: "" }]]) {
  test(`${name} rejected`, () => assert.throws(() => requireSameOrigin(new Request(origin, { headers: { ...headers, ...change } }), origin), AuthFailure));
}
test("body size cap applies to streamed bytes", async () => {
  await assert.rejects(readAuthBody(new Request(origin, { method: "POST", body: JSON.stringify({ token: "x".repeat(12_000) }) })), (e) => e.status === 413);
});
test("malformed JSON rejected", async () => {
  await assert.rejects(readAuthBody(new Request(origin, { method: "POST", body: "{" })), AuthFailure);
});
test("credentials normalized and password limits enforced", () => {
  assert.equal(readCredentials({ email: " TEST@example.com ", password: "secure-password" }).email, "test@example.com");
  assert.throws(() => readCredentials({ email: "bad", password: "short" }), AuthFailure);
});

const context = { user_id: "user", session_id: "session", email_confirmed: true, verification: "verified", credits: 0 };
test("verified zero-credit context accepted", () => assert.equal(requireVerified(parseAuthContext(context)).credits, 0));
for (const verification of ["pending", "verifying", "failed"]) {
  test(`${verification} session denied even with existing identity`, () => assert.throws(() => requireVerified({ ...context, verification }), AuthFailure));
}
test("unconfirmed email denied", () => assert.throws(() => requireVerified({ ...context, email_confirmed: false }), AuthFailure));
test("missing session denied", () => assert.throws(() => requireVerified(null), AuthFailure));
test("malformed DB context fails closed", () => assert.equal(parseAuthContext({ ...context, credits: "100" }), null));
