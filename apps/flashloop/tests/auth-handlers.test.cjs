const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const origin = "https://kumi-staging.vercel.app";
const config = { origin, secret: "test-secret", hostname: "kumi-staging.vercel.app", supabaseUrl: "https://project.supabase.co" };

function load(file, imports, globals = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/auth", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name];
      if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`);
      return imports[name];
    },
    Request, Response, URL, URLSearchParams, AbortSignal, TextDecoder, Uint8Array, Date, Error,
    process: { env: { GOOGLE_AUTH_ENABLED: "true" } }, ...globals,
  });
  return module.exports;
}

function scenario({ contextError = false, beginError = false, providerError = false, finishError = false,
  providerAction = "verify_session", userId = "user", sessionId = "session", edgeError = false, rateHook, signupError = false,
  quotaFull = false, googleEnabled = true, googleError = false, exchangeError = false, exchangeThrows = false,
  googleUrl = `https://project.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(origin + "/api/auth/callback")}` } = {}) {
  const calls = [];
  const limitCalls = [];
  let clientsCreated = 0;
  let state = "pending";
  const context = () => ({ user_id: userId, session_id: sessionId, email_confirmed: true, verification: state, credits: 0 });
  const clients = { config, client: { rpc: async (name) => {
    calls.push(name);
    if (name === "begin_session_verification") {
      if (beginError) return { error: true, data: null };
      state = "verifying";
      return { error: null, data: "attempt" };
    }
    throw new Error("Unexpected RPC");
  }, auth: {
    signUp: async () => { calls.push("signUp"); return { error: signupError ? { message: "private provider failure" } : null, data: { session: null } }; },
    signInWithOAuth: async () => { calls.push("signInWithOAuth"); return { error: googleError ? { message: "private provider failure" } : null, data: { url: googleUrl } }; },
    exchangeCodeForSession: async () => {
      calls.push("exchangeCodeForSession");
      if (exchangeThrows) throw new Error("Private provider error");
      return exchangeError ? { error: true, data: { session: null, user: null } }
        : { error: null, data: { user: { email_confirmed_at: new Date().toISOString() }, session: { id: "oauth-session" } } };
    },
  } }, admin: { rpc: async (name, args) => {
    calls.push(`${name}:${args.p_success}`);
    if (name === "finish_session_verification") {
      state = args.p_success && !finishError ? "verified" : "failed";
      return { data: args.p_success && !finishError, error: finishError || null };
    }
    throw new Error("Unexpected admin RPC");
  } } };
  const security = load("security.ts", {}, { fetch: async () => {
    calls.push("siteverify");
    if (providerError) throw new Error("offline");
    return Response.json({ success: true, hostname: config.hostname, action: providerAction, challenge_ts: new Date().toISOString() });
  } });
  const handlers = load("handlers.ts", {
    "node:crypto": require("node:crypto"),
    "server-only": {}, "next/server": { NextResponse: { json: Response.json, redirect: (url, status) => {
      const response = new Response(null, { status, headers: { location: String(url) } });
      response.cookies = { set(name, value, options) { response.headers.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Max-Age=${options.maxAge}; Path=${options.path}`); } };
      return response;
    } } },
    "@/lib/local-path": { localPath: (value) => value }, "./security": security,
    "@/lib/security/edge-origin": {
      requireEdgeOrigin: () => { if (edgeError) throw new security.AuthFailure("Edge origin rejected."); },
      trustedClientIp: () => "203.0.113.1",
    },
    "./server": {
      authClients: async () => { clientsCreated++; return clients; },
      authContext: async () => { if (contextError) throw new Error("database down"); return context(); },
      rateLimit: async (_clients, key, limit = 5) => {
        calls.push("rateLimit");
        limitCalls.push({ key, limit });
        if (rateHook) await rateHook(key, limit, security.AuthFailure);
      },
      signupPermit: async () => { calls.push("permit"); return "permit"; },
      recheckSignupQuota: async (_clients, ip) => {
        assert.equal(ip, "203.0.113.1");
        calls.push("quotaRecheck");
        if (quotaFull) throw new security.AuthFailure("This network has reached its signup limit.", 429, 345600);
      },
      revokeSession: async () => { state = "failed"; calls.push("revoke", "signOut:local"); },
    },
  }, { process: { env: { GOOGLE_AUTH_ENABLED: String(googleEnabled) } } });
  const request = (body, otherHeaders = {}) => new Request(origin + "/api/auth/verify", {
    method: "POST", headers: { origin, "content-type": "application/json", "x-requested-with": "flashloop", ...otherHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { ...handlers, calls, limitCalls, context, request, security, clientsCreated: () => clientsCreated };
}

for (const [name, options, body] of [
  ["missing token", {}, {}], ["malformed JSON", {}, "{"], ["provider network error", { providerError: true }, { token: "fresh" }],
  ["database context error", { contextError: true }, { token: "fresh" }],
  ["database begin error", { beginError: true }, { token: "fresh" }],
  ["database finish error", { finishError: true }, { token: "fresh" }],
]) test(`${name} denies session and invokes local logout`, async () => {
  const s = scenario(options);
  const result = await s.handleAuthPost(s.request(body), "verify");
  assert.ok(result.status >= 400);
  assert.ok(s.calls.includes("revoke"));
  assert.ok(s.calls.includes("signOut:local"));
  assert.throws(() => s.security.requireVerified(s.context()));
  assert.equal(result.headers.get("cache-control"), "private, no-store");
});

test("success records verification only after Siteverify", async () => {
  const s = scenario();
  const result = await s.handleAuthPost(s.request({ token: "fresh" }), "verify");
  assert.equal(result.status, 200);
  assert.deepEqual(s.calls, ["begin_session_verification", "rateLimit", "siteverify", "finish_session_verification:true"]);
  assert.equal(s.context().verification, "verified");
});

test("session UI binding is opaque, verified-only and changes between sessions", async () => {
  const first = scenario({ userId: "fixture-account-a", sessionId: "fixture-session-a" });
  const readSession = async (client) => (await client.handleAuthGet(new Request(origin + "/api/auth/session"), "session")).json();
  assert.equal((await readSession(first)).sessionScope, undefined);
  await first.handleAuthPost(first.request({ token: "fresh" }), "verify");
  const verified = await readSession(first);
  assert.match(verified.sessionScope, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(verified).includes("fixture-account-a"), false);
  assert.equal(JSON.stringify(verified).includes("fixture-session-a"), false);
  assert.equal((await readSession(first)).sessionScope, verified.sessionScope);
  const next = scenario({ userId: "fixture-account-a", sessionId: "fixture-session-b" });
  await next.handleAuthPost(next.request({ token: "fresh" }), "verify");
  assert.notEqual((await readSession(next)).sessionScope, verified.sessionScope);
});

test("auth GET and POST reject origin bypass before creating clients", async () => {
  const s = scenario({ edgeError: true });
  assert.equal((await s.handleAuthPost(s.request({}), "signup")).status, 403);
  assert.equal((await s.handleAuthGet(new Request(origin + "/api/auth/session"), "session")).status, 403);
  assert.equal(s.clientsCreated(), 0);
  assert.deepEqual(s.calls, []);
});

test("Google OAuth keeps an allowlisted tool and uses the exact Supabase authorize origin", async () => {
  const s = scenario();
  const request = new Request(`${origin}/api/auth/google?kind=image`, { headers: { "sec-fetch-site": "same-origin" } });
  const response = await s.handleAuthGet(request, "google");
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get("location")).origin, "https://project.supabase.co");
  assert.equal(response.headers.get("set-cookie").startsWith("flashloop_auth_kind=image;"), true);
  assert.deepEqual(s.calls, ["rateLimit", "signInWithOAuth"]);
});

test("Google OAuth fails closed on an unexpected authorization destination", async () => {
  const s = scenario({ googleUrl: "https://evil.example/auth/v1/authorize?provider=google" });
  const response = await s.handleAuthGet(new Request(`${origin}/api/auth/google?kind=video`, { headers: { "sec-fetch-site": "same-origin" } }), "google");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("location"), null);
});

test("Google callback consumes the tool cookie and lands in verification", async () => {
  const s = scenario();
  const response = await s.handleAuthGet(new Request(`${origin}/api/auth/callback?code=oauth-code`, { headers: { cookie: "flashloop_auth_kind=video" } }), "callback");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${origin}/auth/verify?kind=video`);
  assert.match(response.headers.get("set-cookie"), /flashloop_auth_kind=; Max-Age=0/);
  assert.ok(s.calls.includes("exchangeCodeForSession"));
});

test("Google denial clears the tool cookie and returns to sign in", async () => {
  const s = scenario();
  const response = await s.handleAuthGet(new Request(`${origin}/api/auth/callback?error=access_denied&error_description=ignored`, { headers: { cookie: "flashloop_auth_kind=image" } }), "callback");
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${origin}/auth?authError=callback&kind=image`);
  assert.match(response.headers.get("set-cookie"), /flashloop_auth_kind=; Max-Age=0/);
  assert.ok(!s.calls.includes("exchangeCodeForSession"));
});

test("Google start stays disabled until explicit provider readiness and rejects cross-site starts", async () => {
  const disabled = scenario({ googleEnabled: false });
  assert.equal((await disabled.handleAuthGet(new Request(`${origin}/api/auth/google`), "google")).status, 503);
  assert.deepEqual(disabled.calls, []);
  for (const headers of [{ "sec-fetch-site": "cross-site" }, { origin: "https://attacker.example" }]) {
    const s = scenario();
    assert.equal((await s.handleAuthGet(new Request(`${origin}/api/auth/google`, { headers }), "google")).status, 403);
    assert.deepEqual(s.calls, []);
  }
});

test("Google start replaces stale and ambiguous tool preferences without forwarding arbitrary navigation", async () => {
  for (const query of ["", "?kind=other", "?kind=image&kind=video", "?returnTo=https://evil.example&prompt=private-fixture"]) {
    const s = scenario();
    const response = await s.handleAuthGet(new Request(`${origin}/api/auth/google${query}`, { headers: { cookie: "flashloop_auth_kind=image" } }), "google");
    assert.equal(response.status, 303);
    assert.match(response.headers.get("set-cookie"), /flashloop_auth_kind=; Max-Age=0/);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("location").includes("private-fixture"), false);
  }
});

test("missing, malformed and ambiguous callback codes recover without an exchange or unrelated logout", async () => {
  for (const query of ["", "?code=", "?code=a&code=b", "?code=%00", "?code=" + "a".repeat(4097)]) {
    const s = scenario();
    const response = await s.handleAuthGet(new Request(`${origin}/api/auth/callback${query}`), "callback");
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${origin}/auth?authError=callback`);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(s.calls, []);
  }
});

test("expired or missing-verifier provider replies return to sign-in without echoing raw errors", async () => {
  for (const options of [{ exchangeError: true }, { exchangeThrows: true }]) {
    const s = scenario(options);
    const response = await s.handleAuthGet(new Request(`${origin}/api/auth/callback?code=synthetic`), "callback");
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${origin}/auth?authError=callback`);
    assert.deepEqual(s.calls, ["exchangeCodeForSession"]);
    assert.equal((await response.text()).includes("Private provider error"), false);
  }
});

test("malformed and duplicate tool cookies cannot interrupt a valid callback or select a destination", async () => {
  for (const cookie of ["flashloop_auth_kind=%E0%A4%A", "flashloop_auth_kind=image; flashloop_auth_kind=video", "flashloop_auth_kind=https://evil.example"]) {
    const s = scenario();
    const response = await s.handleAuthGet(new Request(`${origin}/api/auth/callback?code=synthetic`, { headers: { cookie } }), "callback");
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${origin}/auth/verify`);
  }
});

test("verification limit follows account across fresh sessions", async () => {
  const counters = new Map();
  const rateHook = (key, limit, Failure) => {
    const attempts = (counters.get(key) ?? 0) + 1;
    counters.set(key, attempts);
    if (attempts > limit) throw new Failure("Too many attempts.", 429, 600);
  };
  for (let index = 0; index < 6; index++) {
    const s = scenario({ sessionId: `session-${index}`, rateHook });
    const response = await s.handleAuthPost(s.request({ token: "fresh" }), "verify");
    assert.equal(response.status, index < 5 ? 200 : 429);
    if (index === 5) {
      assert.equal(response.headers.get("retry-after"), "600");
      assert.ok(!s.calls.includes("siteverify"));
      assert.ok(s.calls.includes("revoke"));
    }
  }
  const independent = scenario({ userId: "another-user", rateHook });
  assert.equal((await independent.handleAuthPost(independent.request({ token: "fresh" }), "verify")).status, 200);
});

test("racing signup quota failure is rechecked and returned with96h retry without provider detail", async () => {
  const s = scenario({ providerAction: "signup", signupError: true, quotaFull: true });
  const response = await s.handleAuthPost(s.request({ email: "fixture@example.test", password: "long-password", token: "fresh", captchaToken: "second" }), "signup");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "345600");
  assert.ok(s.calls.includes("quotaRecheck"));
  assert.equal((await response.text()).includes("private provider failure"), false);
});

test("signup provider failure below quota remains generic and never grants a session", async () => {
  const s = scenario({ providerAction: "signup", signupError: true });
  const response = await s.handleAuthPost(s.request({ email: "fixture@example.test", password: "long-password", token: "fresh", captchaToken: "second" }), "signup");
  assert.equal(response.status, 400);
  assert.ok(s.calls.includes("quotaRecheck"));
  assert.equal((await response.text()).includes("private provider failure"), false);
});

test("signup email throttle leaves room for distinct users below shared-IP ceiling", async () => {
  const counters = new Map();
  const rateHook = (key, limit, Failure) => {
    const attempts = (counters.get(key) ?? 0) + 1;
    counters.set(key, attempts);
    if (attempts > limit) throw new Failure("Too many attempts.", 429, 600);
  };
  const s = scenario({ providerAction: "signup", rateHook });
  const signup = (email) => s.handleAuthPost(s.request({
    email, password: "long-password", token: "siteverify-token", captchaToken: "native-token",
  }), "signup");
  for (let index = 0; index < 5; index++) assert.equal((await signup("FIRST@example.com")).status, 200);
  const limited = await signup(" first@example.com ");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "600");
  assert.equal((await signup("second@example.com")).status, 200);
  assert.equal(counters.get("signup:ip:203.0.113.1"), 7);
  assert.equal(counters.get("signup:email:first@example.com"), 6);
  assert.equal(counters.get("signup:email:second@example.com"), 1);
});

test("CSRF cannot force another browser to sign out", async () => {
  const s = scenario();
  const result = await s.handleAuthPost(s.request({}, { origin: "https://attacker.example" }), "verify");
  assert.equal(result.status, 403);
  assert.deepEqual(s.calls, []);
});

test("signup missing CAPTCHA never issues permit or creates user", async () => {
  const s = scenario();
  const result = await s.handleAuthPost(s.request({ email: "test@example.com", password: "long-password" }), "signup");
  assert.equal(result.status, 403);
  assert.ok(!s.calls.includes("permit"));
  assert.ok(!s.calls.includes("signUp"));
});

test("signup cannot double-redeem same token across two validators", async () => {
  const s = scenario();
  const result = await s.handleAuthPost(s.request({ email: "test@example.com", password: "long-password", token: "same", captchaToken: "same" }), "signup");
  assert.equal(result.status, 403);
  assert.deepEqual(s.calls, []);
});

for (const failure of ["throw", "returned-error", "database-throw"]) {
  test(`logout ${failure} still clears all relevant browser cookies`, async () => {
    const deleted = [];
    const security = load("security.ts", {});
    const api = load("server.ts", {
      "server-only": {}, "@supabase/ssr": {}, "@supabase/supabase-js": {},
      "node:crypto": require("node:crypto"), "./security": security,
      "@/lib/security/provider-fetch": {},
      "./config": { authConfig: () => ({ ...config, supabaseUrl: "https://project.supabase.co" }) },
      "next/headers": { cookies: async () => ({
        getAll: () => ["sb-project-auth-token.0", "sb-project-auth-token.1", "sb-project-auth-token-code-verifier", "unrelated"].map((name) => ({ name })),
        set: (name, value, options) => { assert.equal(value, ""); assert.equal(options.maxAge, 0); deleted.push(name); },
      }) },
    });
    const calls = [];
    await assert.rejects(api.revokeSession({ client: {
      rpc: async () => { calls.push("denial"); if (failure === "database-throw") throw new Error("database unavailable"); return { error: null }; },
      auth: { signOut: async (options) => { calls.push(`logout:${options.scope}`); if (failure === "throw") throw new Error("offline"); return { error: failure === "returned-error" }; } },
    } }));
    assert.deepEqual(calls, ["denial", "logout:local"]);
    assert.deepEqual(deleted, ["sb-project-auth-token.0", "sb-project-auth-token.1", "sb-project-auth-token-code-verifier"]);
  });
}
