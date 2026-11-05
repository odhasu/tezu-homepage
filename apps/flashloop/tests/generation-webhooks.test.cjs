const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

class AuthFailure extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

function load(file, imports, environment = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module,
    require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name]; assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; },
    process: { env: environment }, Request, Response, Headers, Uint8Array, TextEncoder, TextDecoder,
    Date, Number, Array, Object, Error, RegExp, JSON, Set, Map, Promise,
  });
  return module.exports;
}

function fixture() {
  const auth = { AuthFailure };
  const webhooks = load("lib/generation/webhooks.ts", {
    "server-only": {}, "node:crypto": { createHash }, "@/lib/auth/security": auth,
  });
  const providers = load("lib/generation/providers.ts", {
    "server-only": {}, "@/lib/auth/security": auth, "@/lib/entitlements/service": {},
  });
  const calls = [];
  const responses = [];
  const client = { async rpc(name, args) {
    calls.push({ name, args });
    if (responses.length) return responses.shift();
    return { data: { applied: true, duplicate: false, status: "committed", requestId: null, jobId: null }, error: null };
  } };
  // Test-only fixture. It is deliberately not registered in production registry;
  // its marker is not any provider's real signing or timestamp protocol.
  const adapter = {
    id: "fixture",
    async dispatch() { return { providerJobId: "fixture-job" }; },
    async verifyCallback({ rawBody, headers, now }) {
      if (headers.get("x-fixture-signature") !== "valid") throw new AuthFailure("Invalid provider callback.", 401);
      if (headers.get("x-fixture-timestamp") !== "fresh") throw new AuthFailure("Invalid provider callback.", 401);
      const value = JSON.parse(new TextDecoder().decode(rawBody));
      return { ...value, timestamp: now };
    },
    async reconcile() { return null; },
  };
  const handlers = load("lib/generation/handlers.ts", {
    "server-only": {}, "@/lib/auth/handlers": {
      authJson(value, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); },
      authError(error) { return Response.json({ error: error instanceof AuthFailure ? error.message : "Generation callback unavailable." }, { status: error.status ?? 503, headers: { "Cache-Control": "private, no-store" } }); },
    }, "@/lib/auth/security": auth, "@/lib/security/edge-origin": { requireEdgeOrigin() {} },
    "@/lib/storage/admin": { storageAdminClient() { throw new Error("admin client must not be created"); } },
    "./providers": providers, "./webhooks": webhooks,
  }, { GENERATION_JOBS_ENABLED: "true", GENERATION_WEBHOOKS_ENABLED: "true" });
  return { calls, responses, client, adapter, handlers };
}

function request(body, signature = "valid", timestamp = "fresh") {
  return new Request("https://example.invalid/api/webhooks/generation/fixture", {
    method: "POST", headers: { "content-type": "application/json", "x-fixture-signature": signature, "x-fixture-timestamp": timestamp },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const callback = { eventId: "event-1", providerJobId: "provider-job-1", outcome: "succeeded", actualCostMicros: 12 };

test("invalid signature, stale, and future fixture callbacks stop before database", async () => {
  for (const [signature, timestamp] of [["bad", "fresh"], ["valid", "stale"], ["valid", "future"]]) {
    const s = fixture();
    const post = s.handlers.createGenerationWebhookHandler({ adapters: { fixture: s.adapter }, client: s.client });
    const response = await post(request(callback, signature, timestamp), { params: Promise.resolve({ provider: "fixture" }) });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(s.calls.length, 0);
  }
});

test("webhook switch independently permits settlement while dispatch jobs stay disabled", async () => {
  const s = fixture();
  const handlers = load("lib/generation/handlers.ts", {
    "server-only": {}, "@/lib/auth/handlers": {
      authJson(value, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); },
      authError(error) { return Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "Cache-Control": "private, no-store" } }); },
    }, "@/lib/auth/security": { AuthFailure }, "@/lib/security/edge-origin": { requireEdgeOrigin() {} },
    "@/lib/storage/admin": { storageAdminClient() { throw new Error("admin client must not be created"); } },
    "./providers": load("lib/generation/providers.ts", { "server-only": {}, "@/lib/auth/security": { AuthFailure }, "@/lib/entitlements/service": {} }),
    "./webhooks": load("lib/generation/webhooks.ts", { "server-only": {}, "node:crypto": { createHash }, "@/lib/auth/security": { AuthFailure } }),
  }, { GENERATION_JOBS_ENABLED: "false", GENERATION_WEBHOOKS_ENABLED: "true" });
  const post = handlers.createGenerationWebhookHandler({ adapters: { fixture: s.adapter }, client: s.client });
  const response = await post(request(callback), { params: Promise.resolve({ provider: "fixture" }) });
  assert.equal(response.status, 200);
});

test("duplicate callback reaches one atomic RPC and second result is duplicate", async () => {
  const s = fixture();
  s.responses.push(
    { data: { applied: true, duplicate: false, status: "committed", requestId: "request-1", jobId: "job-1" }, error: null },
    { data: { applied: false, duplicate: true, status: "committed", requestId: "request-1", jobId: "job-1" }, error: null },
  );
  const post = s.handlers.createGenerationWebhookHandler({ adapters: { fixture: s.adapter }, client: s.client });
  const first = await post(request(callback), { params: Promise.resolve({ provider: "fixture" }) });
  const second = await post(request(callback), { params: Promise.resolve({ provider: "fixture" }) });
  assert.equal(first.status, 200); assert.equal(second.status, 200);
  assert.equal((await first.json()).result.duplicate, false);
  assert.equal((await second.json()).result.duplicate, true);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].args.p_event_id, "event-1");
  assert.equal(Object.hasOwn(s.calls[0].args, "ownerId"), false);
  assert.equal(Object.hasOwn(s.calls[0].args, "credits"), false);
});

test("unknown job cannot mutate status and response stays uncached", async () => {
  const s = fixture();
  s.responses.push({ data: null, error: { code: "P0002", message: "unknown" } });
  const post = s.handlers.createGenerationWebhookHandler({ adapters: { fixture: s.adapter }, client: s.client });
  const response = await post(request({ ...callback, ownerId: "attacker", jobId: "local-job" }), { params: Promise.resolve({ provider: "fixture" }) });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(s.calls.length, 1);
  assert.equal(Object.hasOwn(s.calls[0].args, "ownerId"), false);
  assert.equal(Object.hasOwn(s.calls[0].args, "jobId"), false);
});

test("unknown provider is rejected before admin client creation", async () => {
  const s = fixture();
  const post = s.handlers.createGenerationWebhookHandler({ adapters: {}, clientFactory: () => { throw new Error("must not create"); } });
  const response = await post(request(callback), { params: Promise.resolve({ provider: "unknown" }) });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("oversized streamed body is rejected before verification and database", async () => {
  const s = fixture();
  const post = s.handlers.createGenerationWebhookHandler({ adapters: { fixture: s.adapter }, client: s.client });
  const response = await post(request("x".repeat(64 * 1024 + 1)), { params: Promise.resolve({ provider: "fixture" }) });
  assert.equal(response.status, 413);
  assert.equal(s.calls.length, 0);
});

test("production registry stays empty and fail closed", () => {
  const auth = { AuthFailure };
  const providers = load("lib/generation/providers.ts", { "server-only": {}, "@/lib/auth/security": auth, "@/lib/entitlements/service": {} });
  assert.equal(providers.generationAdaptersReady(), false);
  assert.equal(providers.getGenerationProvider("fixture"), undefined);
  assert.throws(() => providers.generationAdapter("fixture"), { status: 503 });
});

test("invalid callback identity, outcome, and cost never reach settlement RPC", async () => {
  for (const changed of [
    { eventId: "bad\nevent" }, { providerJobId: "" }, { providerJobId: "bad\rjob" },
    { outcome: "pending" }, { actualCostMicros: null }, { actualCostMicros: -1 },
    { actualCostMicros: 1.5 }, { actualCostMicros: 9_000_000_000_000_001 },
    { actualCostMicros: "12" }, { outcome: "running", actualCostMicros: 12 },
  ]) {
    const s = fixture();
    const post = s.handlers.createGenerationWebhookHandler({ adapters: { fixture: s.adapter }, client: s.client });
    const response = await post(request({ ...callback, ...changed }), { params: Promise.resolve({ provider: "fixture" }) });
    assert.equal(response.status, 400);
    assert.equal(s.calls.length, 0);
  }
});

test("changed event conflict remains private without exposing database diagnostics", async () => {
  const s = fixture();
  s.responses.push({ data: null, error: { code: "23505", message: "PRIVATE provider or database diagnostic" } });
  const post = s.handlers.createGenerationWebhookHandler({ adapters: { fixture: s.adapter }, client: s.client });
  const response = await post(request(callback), { params: Promise.resolve({ provider: "fixture" }) });
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.text()).includes("PRIVATE"), false);
});
