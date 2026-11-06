const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest, NextResponse } = require("next/server");

function load(file, imports = {}, env = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name];
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    }, Request, Response, Headers, URL, Error, TextDecoder, Uint8Array, process: { env },
  });
  return module.exports;
}

const cache = load("lib/http/cache-policy.ts");
const creation = load("lib/creation-draft.ts");
const security = load("lib/auth/security.ts");
const privateJson = (body, status = 200) => cache.privateResponse(Response.json(body, { status }));
const authError = (error) => privateJson({ error: error.message }, error.status ?? 503);

test("private responses override all CDN/browser caching and preserve RSC variants", () => {
  for (const status of [200, 201, 303, 307, 400, 401, 403, 404, 405, 409, 429, 500, 503]) {
    const response = new Response(null, { status, headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, s-maxage=3600",
      "Vercel-CDN-Cache-Control": "public, s-maxage=3600",
      Vary: "RSC, Next-Router-State-Tree, cookie",
      "Set-Cookie": "fixture=public-test-value; HttpOnly",
    } });
    assert.equal(cache.privateResponse(response), response);
    for (const [name, value] of Object.entries(cache.PRIVATE_RESPONSE_HEADERS)) assert.equal(response.headers.get(name), value);
    assert.equal(response.headers.get("vary"), "RSC, Next-Router-State-Tree, cookie, Authorization");
    assert.equal(response.headers.get("set-cookie"), "fixture=public-test-value; HttpOnly");
    cache.privateResponse(response);
    assert.equal(response.headers.get("vary"), "RSC, Next-Router-State-Tree, cookie, Authorization");
  }
  const wildcard = cache.privateResponse(new Response(null, { headers: { Vary: "*" } }));
  assert.equal(wildcard.headers.get("vary"), "*");
});

test("private path classification includes future APIs and base paths, excludes public lookalikes", () => {
  for (const path of ["/api", "/api/future/account", "/api/auth/callback", "/api/inngest", "/api/projects/p/storage/o/download", "/auth", "/auth/verify", "/account", "/account/balance"]) {
    assert.equal(cache.isPrivatePath(path), true);
    assert.equal(cache.isPrivatePath(`/flashloop${path}`, "/flashloop"), true);
  }
  for (const path of ["/", "/blue", "/author", "/apiary", "/accounting", "/sites/flashloop/test.jpg", "/_next/static/hash.js"]) {
    assert.equal(cache.isPrivatePath(path), false);
    assert.equal(cache.isPrivatePath(`/flashloop${path}`, "/flashloop"), false);
  }
});

function proxyScenario({ user = null, refresh = false, failure = false, basePath = "" } = {}) {
  const proxy = load("proxy.runtime.ts", {
    "@supabase/ssr": { createServerClient(_url, _key, options) {
      return { auth: { async getUser() {
        if (refresh) options.cookies.setAll([{ name: "fixture-refresh", value: "public-test-value", options: { httpOnly: true } }]);
        return { data: { user }, error: null };
      } } };
    } },
    "next/server": { NextResponse },
    "@/lib/auth/config": { authConfig() {
      if (failure) throw new Error("Fixture failure");
      return { origin: "https://staging.example.test", supabaseUrl: "https://fixture.supabase.co", publishableKey: "public-fixture" };
    } },
    "@/lib/local-path": { localPath: (path) => `${basePath}${path}` },
    "@/lib/creation-draft": creation,
    "@/lib/security/edge-origin": { requireEdgeOrigin() {} },
    "@/lib/security/provider-fetch": {},
    "@/lib/auth/handlers": { authError },
    "@/lib/http/cache-policy": cache,
  }, { NEXT_PUBLIC_BASE_PATH: basePath });
  return (path) => proxy.proxy(new NextRequest(`https://staging.example.test${basePath}${path}`, {
    nextConfig: { basePath },
  }));
}

test("proxy keeps refresh cookies, account redirects, configuration failures and APIs private", async () => {
  for (const options of [{ user: { id: "fixture-account-a" }, refresh: true }, { refresh: true }, { failure: true }]) {
    const response = await proxyScenario(options)("/account");
    for (const [name, value] of Object.entries(cache.PRIVATE_RESPONSE_HEADERS)) assert.equal(response.headers.get(name), value);
    if (options.refresh) assert.match(response.headers.get("set-cookie"), /fixture-refresh=public-test-value/);
    if (!options.user && !options.failure) assert.equal(response.status, 307);
    if (options.failure) assert.equal(response.status, 503);
  }
  for (const path of ["/auth", "/api/future-personalized-route"]) {
    const response = await proxyScenario()(path);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal((await proxyScenario()("/blue")).headers.get("cache-control"), null);
});

test("configured base paths keep account refreshes and auth redirects on NextURL's normalized pathname", async () => {
  const basePath = "/tezu-homepage/flashloop";
  const request = new NextRequest(`https://staging.example.test${basePath}/account`, { nextConfig: { basePath } });
  // Use the actual installed NextRequest behavior, not a synthetic URL object.
  assert.equal(request.nextUrl.pathname, "/account");
  assert.equal(request.nextUrl.basePath, basePath);
  for (const path of ["/account", "/account/billing", "/account/billing/complete"]) {
    const refreshed = await proxyScenario({ basePath, user: { id: "fixture-account-a" }, refresh: true })(path);
    assert.equal(refreshed.status, 200);
    assert.match(refreshed.headers.get("set-cookie"), /fixture-refresh=public-test-value/);
    for (const [name, value] of Object.entries(cache.PRIVATE_RESPONSE_HEADERS)) assert.equal(refreshed.headers.get(name), value);
    const anonymous = await proxyScenario({ basePath, refresh: true })(path);
    assert.equal(anonymous.status, 307);
    assert.equal(anonymous.headers.get("location"), `https://staging.example.test${basePath}/auth`);
    assert.match(anonymous.headers.get("set-cookie"), /fixture-refresh=public-test-value/);
    const unavailable = await proxyScenario({ basePath, failure: true })(path);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("cache-control"), "private, no-store");
  }
  const lookalike = await proxyScenario({ basePath, failure: true })("/accounting");
  assert.equal(lookalike.status, 200);
  assert.equal(lookalike.headers.get("set-cookie"), null);
});

test("anonymous account navigation preserves only one allowlisted tool through auth", async () => {
  const basePath = "/tezu-homepage/flashloop";
  for (const kind of ["image", "video"]) {
    const response = await proxyScenario({ basePath })(`/account?kind=${kind}&prompt=private-test&returnTo=https://invalid.example`);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), `https://staging.example.test${basePath}/auth?kind=${kind}`);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  for (const query of ["kind=image&kind=video", "kind=https%3A%2F%2Finvalid.example", "returnTo=https://invalid.example", "kind=Image"]) {
    const response = await proxyScenario({ basePath })(`/account?${query}`);
    assert.equal(response.headers.get("location"), `https://staging.example.test${basePath}/auth`);
  }
});

/** A controlled cache model, not proof of any browser, deployed CDN or hosted RLS. */
function compliantCache(origin) {
  const entries = new Map();
  let originCalls = 0;
  return {
    entries,
    get originCalls() { return originCalls; },
    async fetch(request) {
      const key = request.url; // Deliberately shared URL: privacy must prevent storage.
      if (entries.has(key)) return entries.get(key).clone();
      originCalls++;
      const response = await origin(request);
      const policy = response.headers.get("cache-control") ?? "";
      // A cache may heuristically retain successful responses and 404s even
      // without explicit max-age. Missing no-store must make this test fail.
      if (!/no-store|private/i.test(policy) && ([200, 404].includes(response.status) || /(?:s-maxage|max-age)=[1-9]/i.test(policy))) {
        entries.set(key, response.clone());
      }
      return response;
    },
  };
}

test("controlled cache positive control retains an unprotected success at a shared URL", async () => {
  const cache = compliantCache(async (request) => Response.json({ principal: request.headers.get("x-fixture-principal") }));
  const request = (principal) => new Request("https://app.example.test/api/shared", { headers: { "x-fixture-principal": principal } });
  assert.equal((await (await cache.fetch(request("A"))).json()).principal, "A");
  assert.equal((await (await cache.fetch(request("B"))).json()).principal, "A");
  assert.equal(cache.originCalls, 1);
});

test("two principals at one URL always reauthorize and never populate controlled browser/CDN caches", async () => {
  const a = "10000000-0000-4000-8000-000000000001";
  const b = "10000000-0000-4000-8000-000000000002";
  const projectId = "20000000-0000-4000-8000-000000000001";
  const rows = [{ id: projectId, owner_id: a, name: "Account A private project" }];
  const sessions = new Set([a, b]);
  let validations = 0;
  function clientFor(owner) {
    return { owner, from() {
      const filters = [];
      const query = {
        select() { return query; },
        eq(name, value) { filters.push([name, value]); return query; },
        async maybeSingle() {
          return { data: rows.find((row) => filters.every(([name, value]) => row[name] === value)) ?? null, error: null };
        },
      };
      return query;
    } };
  }
  const auth = {
    assertUserDataClient() {},
    async requireProtectedSession({ client }) {
      validations++;
      if (!sessions.has(client.owner)) throw new security.AuthFailure("Sign in to continue.", 401);
      return { user_id: client.owner };
    },
  };
  const store = load("lib/ownership/store.ts", { "server-only": {}, "@/lib/auth/server": auth, "@/lib/auth/security": security });
  async function origin(request) {
    const owner = request.headers.get("x-fixture-principal");
    const handlers = load("lib/ownership/handlers.ts", {
      "server-only": {}, "@/lib/auth/server": { async authUserClient() { return { client: clientFor(owner), config: { origin: "https://app.example.test" } }; } },
      "@/lib/auth/security": security, "@/lib/auth/handlers": { authJson: privateJson, authError },
      "./store": store, "@/lib/security/edge-origin": { requireEdgeOrigin() {} },
    });
    return handlers.handleOwnedRequest(request, { projectId });
  }
  const cdn = compliantCache(origin);
  const browser = compliantCache((request) => cdn.fetch(request));
  const request = (principal) => new Request(`https://app.example.test/api/projects/${projectId}`, { headers: principal ? { "x-fixture-principal": principal } : {} });
  const first = await browser.fetch(request(a));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).data.owner_id, a);
  for (const principal of [b, null, b]) {
    const response = await browser.fetch(request(principal));
    assert.equal(response.status, principal ? 404 : 401);
    assert.equal((await response.text()).includes("Account A private project"), false);
  }
  assert.equal((await browser.fetch(request(a))).status, 200);
  sessions.delete(a);
  assert.equal((await browser.fetch(request(a))).status, 401);
  assert.equal(validations, 6);
  assert.equal(browser.originCalls, 6);
  assert.equal(cdn.originCalls, 6);
  assert.equal(browser.entries.size, 0);
  assert.equal(cdn.entries.size, 0);
});
