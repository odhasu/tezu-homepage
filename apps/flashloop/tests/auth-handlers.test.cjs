const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const origin = "https://kumi-staging.vercel.app";
const config = { origin, secret: "test-secret", hostname: "kumi-staging.vercel.app" };

function load(file, imports, globals = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/auth", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`);
      return imports[name];
    },
    Request, Response, URL, URLSearchParams, AbortSignal, TextDecoder, Uint8Array, Date, Error,
    process: { env: {} }, ...globals,
  });
  return module.exports;
}

function scenario({ contextError = false, beginError = false, providerError = false, finishError = false } = {}) {
  const calls = [];
  let state = "pending";
  const context = () => ({ user_id: "user", session_id: "session", email_confirmed: true, verification: state, credits: 0 });
  const clients = { config, client: { rpc: async (name) => {
    calls.push(name);
    if (name === "begin_session_verification") {
      if (beginError) return { error: true, data: null };
      state = "verifying";
      return { error: null, data: "attempt" };
    }
    throw new Error("Unexpected RPC");
  }, auth: {
    signUp: async () => { calls.push("signUp"); return { error: null, data: { session: null } }; },
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
    return Response.json({ success: true, hostname: config.hostname, action: "verify_session", challenge_ts: new Date().toISOString() });
  } });
  const handlers = load("handlers.ts", {
    "server-only": {}, "next/server": { NextResponse: { json: Response.json, redirect: Response.redirect } },
    "@/lib/local-path": { localPath: (value) => value }, "./security": security,
    "./server": {
      authClients: async () => clients,
      authContext: async () => { if (contextError) throw new Error("database down"); return context(); },
      rateLimit: async () => calls.push("rateLimit"),
      signupPermit: async () => { calls.push("permit"); return "permit"; },
      revokeSession: async () => { state = "failed"; calls.push("revoke", "signOut:local"); },
    },
  });
  const request = (body, otherHeaders = {}) => new Request(origin + "/api/auth/verify", {
    method: "POST", headers: { origin, "content-type": "application/json", "x-requested-with": "flashloop", ...otherHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { ...handlers, calls, context, request, security };
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
