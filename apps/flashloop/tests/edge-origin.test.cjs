const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports, env = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    }, Request, Response, Headers, URL, Error, process: { env },
  });
  return module.exports;
}

const security = load("lib/auth/security.ts", {});
const origin = "https://staging.example.com";
const testProof = "local-test-proof-with-at-least-32-characters";
const defaultEnv = { VERCEL: "1", AUTH_ORIGIN: origin, EDGE_ORIGIN_SECRET: testProof };
function edge(env = {}) {
  return load("lib/security/edge-origin.ts", {
    "server-only": {}, "node:crypto": require("node:crypto"), "node:net": require("node:net"),
    "@/lib/auth/security": security,
  }, { ...defaultEnv, ...env });
}
function request(overrides = {}) {
  return new Request(`${origin}/api/auth/signup`, {
    headers: { host: "staging.example.com", "x-flashloop-edge-key": testProof, "cf-connecting-ip": "203.0.113.4", ...overrides },
  });
}

test("configured canonical edge request passes and extracts Cloudflare IP", () => {
  const api = edge();
  assert.doesNotThrow(() => api.requireEdgeOrigin(request()));
  assert.equal(api.trustedClientIp(request()), "203.0.113.4");
});

for (const headers of [
  { "x-flashloop-edge-key": "" }, { "x-flashloop-edge-key": "forged" },
  { "x-flashloop-edge-key": `${testProof}, forged` }, { "x-flashloop-edge-key": "x".repeat(257) },
  { host: "kumi-staging.vercel.app" }, { host: "other.example.com" },
  { host: "staging.example.com:443" },
  { "x-flashloop-edge-key": "", "cf-ray": "forged", "x-forwarded-host": "staging.example.com", "x-vercel-forwarded-for": "203.0.113.4" },
]) test(`rejects origin spoofing: ${Object.keys(headers).join(", ")}`, () => {
  assert.throws(() => edge().requireEdgeOrigin(request(headers)), { status: 403 });
});

for (const env of [
  { EDGE_ORIGIN_SECRET: "" }, { EDGE_ORIGIN_SECRET: "short" }, { AUTH_ORIGIN: "" },
  { AUTH_ORIGIN: "https://kumi-staging.vercel.app" }, { AUTH_ORIGIN: "http://staging.example.com" },
  { AUTH_ORIGIN: "https://staging.example.com/" }, { AUTH_ORIGIN: "https://staging.example.com:8443" },
  { AUTH_ORIGIN: "https://203.0.113.4" }, { AUTH_ORIGIN: "https://user@staging.example.com" },
]) test(`missing/unsafe edge setup fails closed: ${Object.keys(env).join(", ")}`, () => {
  assert.throws(() => edge(env).requireEdgeOrigin(request()), { status: 503 });
});

test("Vercel cannot disable required proof through local opt-out", () => {
  assert.throws(() => edge({ EDGE_PROTECTION_REQUIRED: "false" }).requireEdgeOrigin(request({ "x-flashloop-edge-key": "" })), { status: 403 });
});

test("local opt-in enforces proof; ordinary local checks ignore forwarding headers", () => {
  assert.throws(() => edge({ VERCEL: "", EDGE_PROTECTION_REQUIRED: "true" }).requireEdgeOrigin(request({ "x-flashloop-edge-key": "" })), { status: 403 });
  const api = edge({ VERCEL: "", EDGE_PROTECTION_REQUIRED: "false" });
  assert.equal(api.trustedClientIp(request({ "cf-connecting-ip": "attacker" })), "local");
});

test("IP extraction first authenticates edge and rejects invalid or multiple IPs", () => {
  for (const value of ["", "attacker", "203.0.113.4, 203.0.113.5"]) {
    assert.throws(() => edge().trustedClientIp(request({ "cf-connecting-ip": value })), { status: 403 });
  }
  assert.throws(() => edge().trustedClientIp(request({ "x-flashloop-edge-key": "forged" })), { status: 403 });
  assert.equal(edge().trustedClientIp(request({ "cf-connecting-ip": "2001:0db8:0000:0000:0000:0000:0000:0001" })), "[2001:db8::1]");
});

const workerPublicOrigin = "https://flashloop-staging.fixture.workers.dev";
const workerUpstream = "https://fixture-staging.vercel.app";
function workerEdge(env = {}) {
  return edge({ AUTH_ORIGIN: workerPublicOrigin, EDGE_ORIGIN_MODE: "worker-proxy", EDGE_UPSTREAM_ORIGIN: workerUpstream, ...env });
}
function workerRequest(overrides = {}) {
  return request({ host: "fixture-staging.vercel.app", "x-flashloop-public-host": "flashloop-staging.fixture.workers.dev",
    "x-flashloop-client-ip": "203.0.113.10", "cf-connecting-ip": "198.51.100.10", ...overrides });
}

test("explicit Worker mode authenticates exact upstream and proof-bound public host/IP", () => {
  const api = workerEdge();
  assert.doesNotThrow(() => api.requireEdgeOrigin(workerRequest()));
  assert.equal(api.trustedClientIp(workerRequest()), "203.0.113.10");
  assert.equal(api.trustedClientIp(workerRequest({ "x-flashloop-client-ip": "2001:0db8:0000:0000:0000:0000:0000:0001" })), "[2001:db8::1]");
});

test("Worker mode accepts only configured upstream or this deployment's exact system host", () => {
  const api = workerEdge({ VERCEL_URL: "fixture-staging-immutable.vercel.app" });
  assert.doesNotThrow(() => api.requireEdgeOrigin(workerRequest({ host: "fixture-staging-immutable.vercel.app" })));
  for (const host of ["other.vercel.app", "vercel.app", "fixture-staging.vercel.app.attacker.example", "flashloop-staging.fixture.workers.dev", "fixture-staging.vercel.app:443"]) {
    assert.throws(() => api.requireEdgeOrigin(workerRequest({ host })), { status: 403 });
  }
  assert.throws(() => workerEdge().requireEdgeOrigin(workerRequest({ host: "fixture-staging-immutable.vercel.app" })), { status: 403 });
  assert.throws(() => workerEdge({ VERCEL_URL: "attacker.example" }).requireEdgeOrigin(workerRequest({ host: "attacker.example" })), { status: 403 });
});

for (const headers of [
  { "x-flashloop-edge-key": "" }, { "x-flashloop-edge-key": "forged" },
  { "x-flashloop-public-host": "" }, { "x-flashloop-public-host": "attacker.example" },
  { "x-flashloop-public-host": "flashloop-staging.fixture.workers.dev:443" },
  { "x-flashloop-client-ip": "" }, { "x-flashloop-client-ip": "203.0.113.10, 198.51.100.10" },
  { "x-flashloop-client-ip": "forged", "cf-connecting-ip": "203.0.113.10" },
  { "x-flashloop-public-host": "", "x-forwarded-host": "flashloop-staging.fixture.workers.dev" },
]) test(`Worker mode rejects spoofed/missing metadata: ${Object.keys(headers).join(", ")}`, () => {
  assert.throws(() => workerEdge().requireEdgeOrigin(workerRequest(headers)), { status: 403 });
  assert.throws(() => workerEdge().trustedClientIp(workerRequest(headers)), { status: 403 });
});

for (const env of [
  { EDGE_ORIGIN_MODE: "worker" }, { EDGE_ORIGIN_MODE: "" }, { EDGE_UPSTREAM_ORIGIN: "" },
  { EDGE_UPSTREAM_ORIGIN: "http://fixture-staging.vercel.app" }, { EDGE_UPSTREAM_ORIGIN: "https://outside.example" },
  { EDGE_UPSTREAM_ORIGIN: `${workerUpstream}/path` }, { EDGE_UPSTREAM_ORIGIN: `${workerUpstream}/` },
  { EDGE_UPSTREAM_ORIGIN: `${workerUpstream}?key=fixture` }, { EDGE_UPSTREAM_ORIGIN: `${workerUpstream}:8443` },
  { EDGE_UPSTREAM_ORIGIN: "https://fixture:password@fixture-staging.vercel.app" },
]) test(`Worker mode unsafe configuration fails closed: ${Object.keys(env).join(", ")}`, () => {
  assert.throws(() => workerEdge(env).requireEdgeOrigin(workerRequest()), { status: 503 });
});

test("default transform mode never trusts Worker metadata in place of its canonical Host/IP", () => {
  assert.throws(() => edge().requireEdgeOrigin(workerRequest()), { status: 403 });
  assert.equal(edge().trustedClientIp(request({ "x-flashloop-client-ip": "198.51.100.10" })), "203.0.113.4");
});

test("synthetic Worker transport headers satisfy only its matching Vercel boundary", async () => {
  const { handleStagingProxy } = await import("../cloudflare/staging-proxy.mjs");
  const settings = { ENABLED: "true", PUBLIC_ORIGIN: workerPublicOrigin, UPSTREAM_ORIGIN: workerUpstream, EDGE_ORIGIN_SECRET: testProof };
  const incoming = new Request(`${workerPublicOrigin}/api/auth/session`, { headers: {
    "CF-Connecting-IP": "203.0.113.10", "x-flashloop-edge-key": "forged", "x-flashloop-public-host": "forged.example",
  } });
  let calls = 0;
  const response = await handleStagingProxy(incoming, settings, async (url, init) => {
    calls++;
    const forwarded = new Request(url, init);
    assert.doesNotThrow(() => workerEdge().requireEdgeOrigin(forwarded));
    assert.equal(workerEdge().trustedClientIp(forwarded), "203.0.113.10");
    assert.throws(() => workerEdge({ AUTH_ORIGIN: "https://other.fixture.workers.dev" }).requireEdgeOrigin(forwarded), { status: 403 });
    assert.throws(() => workerEdge({ EDGE_ORIGIN_SECRET: "different-proof-at-least-thirty-two-characters" }).requireEdgeOrigin(forwarded), { status: 403 });
    return Response.json({ authenticated: false });
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await response.text()).includes(testProof), false);
});

test("proxy rejects callbacks, alternate paths, static assets before origin access", async () => {
  const api = edge();
  const proxy = load("proxy.runtime.ts", {
    "@supabase/ssr": { createServerClient() { throw new Error("Must not reach Auth"); } },
    "next/server": { NextResponse: { next: () => new Response(null), json: Response.json } },
    "@/lib/auth/config": { authConfig() { throw new Error("Must not load Auth configuration"); } },
    "@/lib/local-path": { localPath: (path) => path },
    "@/lib/creation-draft": load("lib/creation-draft.ts", {}),
    "@/lib/security/edge-origin": api,
    "@/lib/security/provider-fetch": {},
    "@/lib/http/cache-policy": load("lib/http/cache-policy.ts", {}),
    "@/lib/auth/handlers": { authError: (error) => Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "private, no-store" } }) },
  });
  for (const path of ["/api/auth/signup", "/api/checkout", "/api/whop/webhook", "/api/inngest", "/api/auth/callback", "/api/projects", "/account", "/blue", "/_next/static/test.js"]) {
    const result = await proxy.proxy({ headers: request({ "x-flashloop-edge-key": "" }).headers, nextUrl: new URL(origin + path) });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal((await result.text()).includes(testProof), false);
  }
  assert.equal(proxy.config.matcher[0], "/:path*");
});
