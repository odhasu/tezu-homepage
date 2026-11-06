const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const origin = "https://staging.example.test";

function load(path, imports, globals = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module,
    require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name]; assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; },
    Request, Response, URL, URLSearchParams, AbortSignal, TextDecoder, Uint8Array, Date, Error, ...globals,
  });
  return module.exports;
}

const security = load("lib/auth/security.ts", {});
const { AuthFailure } = security;
const authResponses = load("lib/auth/handlers.ts", {
  "node:crypto": require("node:crypto"),
  "server-only": {}, "next/server": { NextResponse: { json: Response.json, redirect: Response.redirect } },
  "@/lib/local-path": {}, "@/lib/security/edge-origin": {}, "./server": {}, "./security": security,
});

function checkoutScenario({ edgeError = false, context = { user_id: "account-one" }, counters = new Map() } = {}) {
  const calls = [];
  const edge = {
    requireEdgeOrigin: () => { if (edgeError) throw new AuthFailure("Edge origin rejected."); },
  };
  const authServer = {
      authClients: async () => { calls.push("clients"); return { config: { origin } }; },
      requireProtectedSession: async () => {
        calls.push("authorize");
        if (context === null) throw new AuthFailure("Sign in to continue.", 401);
        if (context.verification === "pending") throw new AuthFailure("Complete account verification first.");
        return context;
      },
      rateLimit: async (_clients, key, limit) => {
        calls.push({ key, limit });
        const attempts = (counters.get(key) ?? 0) + 1;
        counters.set(key, attempts);
        if (attempts > limit) throw new AuthFailure("Too many attempts.", 429, 600);
      },
  };
  // This boundary test isolates the stable checkout import from provider billing.
  // Provider behavior is covered by the billing test suite.
  const checkout = load("lib/checkout/handlers.ts", {
    "server-only": {}, "@/lib/auth/handlers": authResponses, "@/lib/auth/security": security,
    "@/lib/security/edge-origin": edge, "@/lib/auth/server": authServer,
    "@/lib/billing/handlers": {
      handleCheckoutPost: async (request) => {
        try {
          edge.requireEdgeOrigin(request);
          const clients = await authServer.authClients();
          security.requireSameOrigin(request, clients.config.origin);
          const session = await authServer.requireProtectedSession(clients);
          await authServer.rateLimit(clients, `checkout:account:${session.user_id}`, 5);
          throw new AuthFailure("Checkout is unavailable. Payments are not enabled.", 503, 600);
        } catch (error) { return authResponses.authError(error); }
      },
    },
  });
  const request = (change = {}, body = { userId: "forged-account", entitlement: true }) => new Request(origin + "/api/checkout", {
    method: "POST", body: JSON.stringify(body),
    headers: { origin, "content-type": "application/json", "x-requested-with": "flashloop", ...change },
  });
  return { ...checkout, request, calls, counters };
}

test("deferred checkout returns uncached 503 and never calls payment or entitlement code", async () => {
  const s = checkoutScenario();
  const response = await s.handleCheckoutPost(s.request());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "600");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { error: "Checkout is unavailable. Payments are not enabled." });
  assert.deepEqual(s.calls, ["clients", "authorize", { key: "checkout:account:account-one", limit: 5 }]);
});

test("checkout burst model shares account counter across IPs and sessions", async () => {
  const counters = new Map();
  for (let index = 0; index < 6; index++) {
    const s = checkoutScenario({ counters, context: { user_id: "account-one", session_id: `session-${index}` } });
    const response = await s.handleCheckoutPost(s.request({ "cf-connecting-ip": `203.0.113.${index + 1}` }));
    assert.equal(response.status, index < 5 ? 503 : 429);
    assert.equal(response.headers.get("retry-after"), "600");
  }
  assert.equal(counters.get("checkout:account:account-one"), 6);
  assert.equal(counters.has("checkout:account:forged-account"), false);
});

test("checkout account throttle keeps shared-IP users independent", async () => {
  const counters = new Map([["checkout:account:account-one", 5]]);
  const limited = checkoutScenario({ counters });
  assert.equal((await limited.handleCheckoutPost(limited.request({ "cf-connecting-ip": "203.0.113.1" }))).status, 429);
  const other = checkoutScenario({ counters, context: { user_id: "account-two" } });
  assert.equal((await other.handleCheckoutPost(other.request({ "cf-connecting-ip": "203.0.113.1" }))).status, 503);
  assert.equal(counters.get("checkout:account:account-two"), 1);
});

for (const [name, context, status] of [["anonymous", null, 401], ["unverified", { user_id: "account-one", verification: "pending" }, 403]]) {
  test(`${name} checkout cannot consume authenticated account limits`, async () => {
    const s = checkoutScenario({ context });
    assert.equal((await s.handleCheckoutPost(s.request())).status, status);
    assert.equal(s.counters.size, 0);
  });
}

test("checkout direct-origin and CSRF rejection precede account limits", async () => {
  const direct = checkoutScenario({ edgeError: true });
  assert.equal((await direct.handleCheckoutPost(direct.request())).status, 403);
  assert.deepEqual(direct.calls, []);
  const csrf = checkoutScenario();
  assert.equal((await csrf.handleCheckoutPost(csrf.request({ origin: "https://attacker.example" }))).status, 403);
  assert.deepEqual(csrf.calls, ["clients"]);
});

function rateScenario(reply, throws = false) {
  const api = load("lib/auth/server.ts", {
    "server-only": {}, "@supabase/ssr": {}, "@supabase/supabase-js": {}, "next/headers": {},
    "node:crypto": require("node:crypto"), "./config": {}, "./security": security,
    "@/lib/security/provider-fetch": {},
  });
  const calls = [];
  const clients = { admin: { rpc(name, args) {
    calls.push({ name, args });
    if (throws) throw new Error("Network unavailable");
    return { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return Promise.resolve(reply); } };
  } } };
  return { api, clients, calls };
}

test("shared limiter sends hashed key, explicit 600-second window, and timeout signal", async () => {
  const s = rateScenario({ data: true, error: null });
  await s.api.rateLimit(s.clients, "checkout:account:account-one", 5);
  assert.equal(s.calls[0].name, "consume_auth_rate_limit");
  assert.match(s.calls[0].args.p_key, /^[a-f0-9]{64}$/);
  assert.equal(s.calls[0].args.p_limit, 5);
  assert.equal(s.calls[0].args.p_window_seconds, 600);
});

for (const [name, reply, throws, status] of [
  ["counter denial", { data: false, error: null }, false, 429],
  ["database error", { data: null, error: { code: "offline" } }, false, 503],
  ["network failure", null, true, 503],
]) {
  test(`${name} fails closed with conservative retry window`, async () => {
    const s = rateScenario(reply, throws);
    await assert.rejects(s.api.rateLimit(s.clients, "signup:email:test@example.test"), (error) => {
      const response = authResponses.authError(error);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("retry-after"), "600");
      return true;
    });
  });
}

test("error responses never propagate invalid Retry-After values", () => {
  for (const retryAfter of [0, -1, Infinity, 0.5, 345601, "600\r\nInjected: true"]) {
    const response = authResponses.authError(new AuthFailure("Unavailable.", 503, retryAfter));
    assert.equal(response.headers.get("retry-after"), null);
  }
});

function permitScenario(data, ipSecret = "fixture-stable-hmac-secret-at-least-32-characters", error = null) {
  const calls = [];
  const api = load("lib/auth/server.ts", {
    "server-only": {}, "@supabase/ssr": {}, "@supabase/supabase-js": {}, "next/headers": {},
    "node:crypto": require("node:crypto"), "./config": {}, "./security": security,
    "@/lib/security/provider-fetch": {},
  }, { process: { env: { SIGNUP_IP_HASH_SECRET: ipSecret } } });
  const clients = { admin: { rpc: async (name, args) => { calls.push({ name, args }); return { data, error }; } } };
  return { api, clients, calls };
}

test("signup permit binds private IP HMAC to random permit without storing raw IP", async () => {
  const s = permitScenario({ allowed: true, retry_after_seconds: 0 });
  const permit = await s.api.signupPermit(s.clients, "fixture@example.test", "203.0.113.7");
  assert.match(permit, /^[a-f0-9]{64}$/);
  assert.equal(s.calls[0].name, "issue_signup_permit_for_ip");
  assert.equal(s.calls[0].args.p_email, "fixture@example.test");
  assert.equal(s.calls[0].args.p_permit_hash, require("node:crypto").createHash("sha256").update(permit).digest("hex"));
  assert.match(s.calls[0].args.p_ip_key_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(s.calls).includes("203.0.113.7"), false);
  await s.api.signupPermit(s.clients, "another@example.test", "203.0.113.7");
  assert.equal(s.calls[0].args.p_ip_key_hash, s.calls[1].args.p_ip_key_hash);
  assert.notEqual(s.calls[0].args.p_permit_hash, s.calls[1].args.p_permit_hash);
});

test("full rolling96h signup quota returns exact validated remaining Retry-After", async () => {
  const s = permitScenario({ allowed: false, retry_after_seconds: 345600 });
  await assert.rejects(s.api.signupPermit(s.clients, "fixture@example.test", "203.0.113.7"), (error) => {
    const response = authResponses.authError(error);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "345600");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    return true;
  });
});

test("failure-only signup quota recheck cannot issue a new permit", async () => {
  const s = permitScenario({ allowed: false, retry_after_seconds: 12345 });
  await assert.rejects(s.api.recheckSignupQuota(s.clients, "203.0.113.7"), { status: 429, retryAfter: 12345 });
  assert.equal(s.calls[0].name, "get_signup_ip_quota");
  assert.deepEqual(Object.keys(s.calls[0].args), ["p_ip_key_hash"]);
});

test("missing IP HMAC secret fails before database or permit issuance", async () => {
  const s = permitScenario({ allowed: true }, "");
  await assert.rejects(s.api.signupPermit(s.clients, "fixture@example.test", "203.0.113.7"), { status: 503 });
  assert.equal(s.calls.length, 0);
});

for (const data of [null, true, {}, { allowed: false, retry_after_seconds: 0 }, { allowed: false, retry_after_seconds: 345601 }]) {
  test("malformed signup quota result cannot issue a permit", async () => {
    const s = permitScenario(data);
    await assert.rejects(s.api.signupPermit(s.clients, "fixture@example.test", "203.0.113.7"), { status: 503 });
  });
}
