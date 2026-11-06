const assert = require("node:assert/strict");
const { createHash, randomBytes } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const ssr = require("@supabase/ssr");
const supabase = require("@supabase/supabase-js");
const { NextResponse } = require("next/server");

// Installed-SDK integration with a bounded, entirely local Auth fixture. This
// does not contact Supabase/Google or prove hosted code expiry/single use,
// browser cookie enforcement, CAPTCHA, RLS, or production acceptance.
const config = {
  origin: "https://app.example.test",
  hostname: "app.example.test",
  supabaseUrl: "https://fixture.supabase.co",
  publishableKey: "sb_publishable_local_fixture_only",
  secretKey: "sb_secret_local_fixture_only",
};
const storageKey = "sb-fixture-auth-token";
const verifierKey = `${storageKey}-code-verifier`;
const callback = `${config.origin}/api/auth/callback`;
const hash = (value) => createHash("sha256").update(value).digest("base64url");

function load(file, imports = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    },
    Request, Response, Headers, URL, URLSearchParams, AbortSignal, TextDecoder, Uint8Array,
    Date, Error, process: { env: { GOOGLE_AUTH_ENABLED: "true" } }, ...globals,
  });
  return module.exports;
}

const security = load("lib/auth/security.ts");
const cache = load("lib/http/cache-policy.ts");

function cookieJar(initial = []) {
  const values = new Map(initial.map(({ name, value }) => [name, value]));
  return {
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    get: (name) => values.get(name),
    replace: (name, value) => values.set(name, value),
    has: (name) => values.has(name),
    sessionNames: () => [...values.keys()].filter((name) => name === storageKey || new RegExp(`^${storageKey}\\.\\d+$`).test(name)),
    request() {
      const response = new NextResponse(null);
      const writes = [];
      return {
        response, writes,
        store: {
          getAll: () => this.getAll(),
          set(name, value, options) {
            writes.push({ name, value, options });
            response.cookies.set(name, value, options);
            if (options.maxAge === 0) values.delete(name);
            else values.set(name, value);
          },
        },
      };
    },
  };
}

function fixture() {
  const grants = new Map();
  let calls = 0;
  let accepted = 0;
  let rejected = 0;
  const accessToken = randomBytes(48).toString("base64url");
  const refreshToken = randomBytes(48).toString("base64url");
  const userId = "10000000-0000-4000-8000-000000000001";
  const session = {
    access_token: accessToken, refresh_token: refreshToken, token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: userId, aud: "authenticated", role: "authenticated", email: "fixture@example.test",
      email_confirmed_at: "2026-11-06T00:00:00.000Z", created_at: "2026-11-06T00:00:00.000Z",
      app_metadata: { provider: "google", providers: ["google"] },
      // Force actual SSR cookie chunking, rather than testing a hand-made
      // session-cookie representation.
      user_metadata: { fixture_padding: "x".repeat(5000) },
    },
  };
  const deny = (code) => Response.json({ error_code: code, message: "Local PKCE fixture denied." }, { status: 400 });
  return {
    get calls() { return calls; },
    get accepted() { return accepted; },
    get rejected() { return rejected; },
    userId,
    hasFixtureTokens: (value) => value?.access_token === accessToken && value?.refresh_token === refreshToken,
    issue(authorization) {
      const code = randomBytes(24).toString("base64url");
      grants.set(code, { challenge: new URL(authorization).searchParams.get("code_challenge"), used: false });
      return code;
    },
    async fetch(input, init) {
      calls++;
      // No live fetch fallback exists. Even an unexpected request must stay
      // in this fixture, and diagnostics must never print its body/headers.
      const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
      assert.ok(url.origin === config.supabaseUrl, "SDK request must stay within the fixture origin");
      assert.equal(url.pathname, "/auth/v1/token");
      assert.equal(url.search, "?grant_type=pkce");
      assert.equal(init.method, "POST");
      assert.equal(init.cache, "no-store");
      assert.equal(init.next, undefined);
      assert.ok(init.signal instanceof AbortSignal && !init.signal.aborted, "actual bounded fetch must supply a live cancellation/deadline signal");
      assert.ok(typeof init.body === "string" && init.body.length <= 4096, "exchange body must be bounded");
      const body = JSON.parse(init.body);
      assert.deepEqual(Object.keys(body).sort(), ["auth_code", "code_verifier"]);
      const grant = grants.get(body.auth_code);
      if (!grant || grant.used || typeof body.code_verifier !== "string" || hash(body.code_verifier) !== grant.challenge) {
        rejected++;
        return deny(grant?.used ? "flow_state_not_found" : "bad_code_verifier");
      }
      grant.used = true;
      accepted++;
      return Response.json(session);
    },
  };
}

async function requestClient(jar, provider, writable = true) {
  const request = jar.request();
  const providerFetch = load("lib/security/provider-fetch.ts", { "server-only": {} }, { fetch: provider.fetch.bind(provider) });
  const server = load("lib/auth/server.ts", {
    "server-only": {}, "@supabase/ssr": ssr, "@supabase/supabase-js": supabase,
    "next/headers": { cookies: async () => request.store },
    "node:crypto": require("node:crypto"),
    "@/lib/security/provider-fetch": providerFetch,
    "./config": { authConfig: () => config }, "./security": security,
  });
  const clients = await server.authUserClient(writable);
  assert.ok(clients.client instanceof supabase.SupabaseClient, "factory must return the installed SDK client");
  server.assertUserDataClient(clients.client);
  return { ...request, ...clients, server };
}

async function start(jar, provider) {
  const request = await requestClient(jar, provider);
  const result = await request.client.auth.signInWithOAuth({
    provider: "google", options: { redirectTo: callback, queryParams: { prompt: "select_account" } },
  });
  assert.equal(result.error, null);
  return { ...request, authorization: result.data.url };
}

function assertCookieSecurity(request, name) {
  const writes = request.writes.filter((cookie) => cookie.name === name);
  assert.ok(writes.length > 0, "expected SDK cookie write");
  for (const { options } of writes) {
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    if (name.endsWith("-code-verifier") && options.maxAge !== 0) {
      assert.ok(options.maxAge > 0 && options.maxAge <= 600, "PKCE cookies must use the bounded verifier lifetime, not the session lifetime");
    }
  }
  const wire = request.response.headers.getSetCookie().filter((value) => value.startsWith(`${name}=`));
  assert.ok(wire.length > 0 && wire.every((value) => /; HttpOnly(?:;|$)/.test(value) && /; Secure(?:;|$)/.test(value) && /; SameSite=lax(?:;|$)/.test(value)), "installed Next serializer must preserve the security attributes");
}

test("installed SDK Google PKCE start writes secured verifier cookies matching an S256 challenge", async () => {
  const jar = cookieJar();
  const provider = fixture();
  const request = await start(jar, provider);
  const authorization = new URL(request.authorization);
  assert.equal(authorization.origin, config.supabaseUrl);
  assert.equal(authorization.pathname, "/auth/v1/authorize");
  assert.equal(authorization.searchParams.get("provider"), "google");
  assert.equal(authorization.searchParams.get("redirect_to"), callback);
  assert.equal(authorization.searchParams.get("prompt"), "select_account");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "s256");
  assert.equal(provider.calls, 0);
  assert.ok(jar.has(verifierKey), "legacy verifier must persist before a redirect returns");
  const verifier = JSON.parse(ssr.stringFromBase64URL(jar.get(verifierKey).slice("base64-".length)));
  assert.ok(typeof verifier === "string" && verifier.length >= 43 && verifier.length <= 1024, "actual SDK verifier must be nonempty and bounded");
  assert.ok(hash(verifier) === authorization.searchParams.get("code_challenge"), "challenge must derive from the cookie verifier without exposing it");
  for (const { name } of jar.getAll().filter(({ name }) => name.endsWith("-code-verifier"))) {
    assertCookieSecurity(request, name);
    assert.ok(request.writes.filter((cookie) => cookie.name === name).every(({ options }) => options.maxAge === 600), "verifier cookies must have a ten-minute lifetime");
  }
  assert.equal(jar.sessionNames().length, 0);
});

test("new-request SDK exchange consumes the verifier and persists secured chunked session cookies", async () => {
  const jar = cookieJar();
  const provider = fixture();
  const started = await start(jar, provider);
  const code = provider.issue(started.authorization);
  const callbackRequest = await requestClient(jar, provider);
  const result = await callbackRequest.client.auth.exchangeCodeForSession(code);
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, provider.userId);
  assert.ok(provider.hasFixtureTokens(result.data.session), "SDK must return the fixture session");
  assert.equal(provider.accepted, 1);
  assert.equal(provider.calls, 1);
  assert.equal(jar.has(verifierKey), false);
  assert.ok(callbackRequest.writes.some(({ name, value, options }) => name === verifierKey && value === "" && options.maxAge === 0), "successful exchange must expire the callback's verifier cookie");
  assertCookieSecurity(callbackRequest, verifierKey);
  assert.ok(jar.sessionNames().length > 1, "actual SSR must split the large session into cookies");
  for (const name of jar.sessionNames()) assertCookieSecurity(callbackRequest, name);
  const nextRequest = await requestClient(jar, provider);
  // getSession proves only SDK cookie serialization/readback, not identity or
  // authorization: production guards still call live getUser/context/RLS.
  const restored = await nextRequest.client.auth.getSession();
  assert.equal(restored.error, null);
  assert.ok(provider.hasFixtureTokens(restored.data.session), "fresh SDK client must reassemble its own session cookies");
  assert.equal(provider.calls, 1);
});

test("missing verifier denies through the real SDK before any transport or session write", async () => {
  const jar = cookieJar();
  const provider = fixture();
  const request = await requestClient(jar, provider);
  const result = await request.client.auth.exchangeCodeForSession("local-unused-code");
  assert.equal(result.error?.code, "pkce_code_verifier_not_found");
  assert.equal(result.data.session, null);
  assert.equal(provider.calls, 0);
  assert.equal(jar.sessionNames().length, 0);
});

test("wrong browser verifier is rejected by local PKCE validation without session cookies", async () => {
  const owner = cookieJar();
  const otherBrowser = cookieJar();
  const provider = fixture();
  const ownerStart = await start(owner, provider);
  const code = provider.issue(ownerStart.authorization);
  await start(otherBrowser, provider);
  const request = await requestClient(otherBrowser, provider);
  const result = await request.client.auth.exchangeCodeForSession(code);
  assert.equal(result.error?.code, "bad_code_verifier");
  assert.equal(result.data.session, null);
  assert.equal(provider.accepted, 0);
  assert.equal(provider.rejected, 1);
  assert.equal(otherBrowser.sessionNames().length, 0);
});

test("invalid verifier cookie reaches only the bounded fixture and cannot mint a session", async () => {
  const jar = cookieJar();
  const provider = fixture();
  const started = await start(jar, provider);
  const code = provider.issue(started.authorization);
  jar.replace(verifierKey, `base64-${ssr.stringToBase64URL(JSON.stringify("invalid-local-verifier"))}`);
  const request = await requestClient(jar, provider);
  const result = await request.client.auth.exchangeCodeForSession(code);
  assert.equal(result.error?.code, "bad_code_verifier");
  assert.equal(result.data.session, null);
  assert.equal(provider.calls, 1);
  assert.equal(provider.accepted, 0);
  assert.equal(jar.sessionNames().length, 0);
});

test("reused successful callback lacks a verifier and cannot call the token endpoint again", async () => {
  const jar = cookieJar();
  const provider = fixture();
  const started = await start(jar, provider);
  const code = provider.issue(started.authorization);
  const first = await requestClient(jar, provider);
  assert.equal((await first.client.auth.exchangeCodeForSession(code)).error, null);
  const again = await requestClient(jar, provider);
  const result = await again.client.auth.exchangeCodeForSession(code);
  assert.equal(result.error?.code, "pkce_code_verifier_not_found");
  assert.equal(result.data.session, null);
  assert.equal(provider.calls, 1);
  assert.equal(provider.accepted, 1);
  assert.equal(again.writes.length, 0);
});

test("replaying a pre-callback cookie snapshot is denied by the local single-use code fixture", async () => {
  const jar = cookieJar();
  const provider = fixture();
  const started = await start(jar, provider);
  const beforeCallback = cookieJar(jar.getAll());
  const code = provider.issue(started.authorization);
  const first = await requestClient(jar, provider);
  assert.equal((await first.client.auth.exchangeCodeForSession(code)).error, null);
  const replay = await requestClient(beforeCallback, provider);
  const result = await replay.client.auth.exchangeCodeForSession(code);
  assert.equal(result.error?.code, "flow_state_not_found");
  assert.equal(result.data.session, null);
  assert.equal(provider.calls, 2);
  assert.equal(provider.accepted, 1);
  assert.equal(provider.rejected, 1);
  assert.equal(beforeCallback.sessionNames().length, 0);
});

test("read-only factory cannot persist a Google verifier for a later request", async () => {
  const jar = cookieJar();
  const provider = fixture();
  const readonly = await requestClient(jar, provider, false);
  const startResult = await readonly.client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback } });
  assert.equal(startResult.error, null);
  assert.equal(readonly.writes.length, 0);
  assert.equal(jar.getAll().length, 0);
  const callbackRequest = await requestClient(jar, provider);
  const result = await callbackRequest.client.auth.exchangeCodeForSession(provider.issue(startResult.data.url));
  assert.equal(result.error?.code, "pkce_code_verifier_not_found");
  assert.equal(result.data.session, null);
  assert.equal(provider.calls, 0);
});

test("Google handlers use actual SDK cookies across start and callback before the verification redirect", async () => {
  const jar = cookieJar();
  const provider = fixture();
  function handlers(request) {
    return load("lib/auth/handlers.ts", {
      "server-only": {}, "node:crypto": require("node:crypto"), "next/server": { NextResponse },
      "@/lib/http/cache-policy": cache, "@/lib/local-path": { localPath: (path) => path },
      "@/lib/security/edge-origin": { requireEdgeOrigin() {}, trustedClientIp: () => "203.0.113.1" },
      "./security": security,
      "./server": { ...request.server, authClients: async () => ({ config, client: request.client }), rateLimit: async () => {} },
    });
  }
  const startRequest = await requestClient(jar, provider);
  const begin = await handlers(startRequest).handleAuthGet(new Request(`${config.origin}/api/auth/google?kind=video`, {
    headers: { "sec-fetch-site": "same-origin" },
  }), "google");
  assert.equal(begin.status, 303);
  assert.equal(begin.headers.get("cache-control"), "private, no-store");
  assert.equal(begin.cookies.get("flashloop_auth_kind").value, "video");
  assert.ok(jar.has(verifierKey), "handler must write a real SDK verifier before redirecting");
  const code = provider.issue(begin.headers.get("location"));
  const callbackRequest = await requestClient(jar, provider);
  const response = await handlers(callbackRequest).handleAuthGet(new Request(`${callback}?code=${encodeURIComponent(code)}`, {
    headers: { cookie: "flashloop_auth_kind=video" },
  }), "callback");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${config.origin}/auth/verify?kind=video`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.cookies.get("flashloop_auth_kind").maxAge, 0);
  assert.equal(jar.has(verifierKey), false);
  assert.ok(jar.sessionNames().length > 0);
  assert.equal(provider.accepted, 1);
});
