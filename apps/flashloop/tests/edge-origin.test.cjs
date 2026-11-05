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

test("proxy rejects callbacks, alternate paths, static assets before origin access", async () => {
  const api = edge();
  const proxy = load("proxy.runtime.ts", {
    "@supabase/ssr": { createServerClient() { throw new Error("Must not reach Auth"); } },
    "next/server": { NextResponse: { next: () => new Response(null), json: Response.json } },
    "@/lib/auth/config": { authConfig() { throw new Error("Must not load Auth configuration"); } },
    "@/lib/local-path": { localPath: (path) => path },
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
