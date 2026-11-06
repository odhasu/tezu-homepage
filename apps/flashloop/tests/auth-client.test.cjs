const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(readFileSync(resolve(__dirname, "../src/components/auth/auth-api.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function client(response) {
  let calls = 0;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    exports: module.exports, module,
    require(name) {
      assert.equal(name, "@/lib/local-path");
      return { localPath: (path) => path };
    },
    fetch: async () => { calls++; return response; },
    AbortSignal, Date, Error,
  });
  return { ...module.exports, calls: () => calls };
}

test("retry parser preserves delta seconds and rounds future HTTP dates upward", () => {
  const api = client();
  const now = Date.UTC(2026, 10, 4, 12);
  assert.equal(api.readRetryAfter("600", now), 600);
  assert.equal(api.readRetryAfter(" 12 ", now), 12);
  assert.equal(api.readRetryAfter("Wed, 04 Nov 2026 12:00:11 GMT", now + 1), 11);
  assert.equal(api.readRetryAfter("0", now), 1);
});

test("missing, malformed, past and unsafe retry values use bounded edge fallback", () => {
  const api = client();
  const now = Date.UTC(2026, 10, 4, 12);
  for (const value of [null, "", "-1", "1.5", "Infinity", "9999999999999999999999", "bad", "Wed, 04 Nov 2026 11:59:59 GMT"]) {
    assert.equal(api.readRetryAfter(value, now), 10);
  }
});

test("HTML Cloudflare 429 exposes ten-second delay without reflecting HTML or retrying", async () => {
  const api = client(new Response("<html>Cloudflare rate limit</html>", { status: 429 }));
  await assert.rejects(api.postAuth("signup", {}), (error) => {
    assert.ok(error instanceof api.AuthRateLimitError);
    assert.equal(error.retryAfterSeconds, 10);
    assert.ok(!error.message.includes("<html>"));
    return true;
  });
  assert.equal(api.calls(), 1);
});

test("server JSON 429 retains its longer wait without an automatic retry", async () => {
  const api = client(Response.json({ error: "Too many attempts." }, { status: 429, headers: { "retry-after": "600" } }));
  await assert.rejects(api.postAuth("verify", { token: "fresh-fixture-token" }), (error) => {
    assert.ok(error instanceof api.AuthRateLimitError);
    assert.equal(error.retryAfterSeconds, 600);
    return true;
  });
  assert.equal(api.calls(), 1);
});

test("session checks surface rate limits without treating response as authenticated", async () => {
  const api = client(Response.json({ authenticated: true, verified: true }, { status: 429, headers: { "retry-after": "30" } }));
  await assert.rejects(api.getAuthSession(), (error) => {
    assert.ok(error instanceof api.AuthRateLimitError);
    assert.equal(error.retryAfterSeconds, 30);
    return true;
  });
  assert.equal(api.calls(), 1);
});

test("temporary limiter failure honors server wait and safe JSON message without claiming excess attempts", async () => {
  const message = "Request limits are temporarily unavailable. Please try again later.";
  const api = client(Response.json({ error: message }, { status: 503, headers: { "retry-after": "600" } }));
  await assert.rejects(api.postAuth("signup", {}), (error) => {
    assert.ok(error instanceof api.AuthRetryError);
    assert.ok(!(error instanceof api.AuthRateLimitError));
    assert.equal(error.retryAfterSeconds, 600);
    assert.equal(error.message, message);
    return true;
  });
  assert.equal(api.calls(), 1);
});

test("temporary HTML service failure uses generic message with advertised delay", async () => {
  const api = client(new Response("<html>Service unavailable</html>", { status: 503, headers: { "retry-after": "30" } }));
  await assert.rejects(api.getAuthSession(), (error) => {
    assert.ok(error instanceof api.AuthRetryError);
    assert.equal(error.retryAfterSeconds, 30);
    assert.equal(error.message, "Account access is temporarily unavailable. Please try again later.");
    return true;
  });
  assert.equal(api.calls(), 1);
});

test("503 without Retry-After retains ordinary error behavior without a cooldown", async () => {
  const api = client(Response.json({ error: "Account access is unavailable." }, { status: 503 }));
  await assert.rejects(api.postAuth("signin", {}), (error) => {
    assert.ok(!(error instanceof api.AuthRetryError));
    assert.equal(error.message, "Account access is unavailable.");
    return true;
  });
});

test("non-rate errors retain existing message and never acquire retry state", async () => {
  const api = client(Response.json({ error: "Security check failed." }, { status: 403 }));
  await assert.rejects(api.postAuth("signin", {}), (error) => {
    assert.ok(!(error instanceof api.AuthRateLimitError));
    assert.equal(api.authErrorMessage(error), "Security check failed.");
    return true;
  });
});

test("successful signup preserves confirmation handoff", async () => {
  const api = client(Response.json({ ok: true, confirmationRequired: true }));
  const result = await api.postAuth("signup", {});
  assert.equal(result.ok, true);
  assert.equal(result.confirmationRequired, true);
  assert.equal(api.calls(), 1);
});

test("session parser accepts only the opaque bounded UI binding", async () => {
  for (const value of ["a".repeat(64), "invalid", "a".repeat(65), "https://invalid.example", null]) {
    const api = client(Response.json({ authenticated: true, verified: true, emailConfirmed: true, sessionScope: value }));
    const result = await api.getAuthSession();
    assert.equal(result.sessionScope, value === "a".repeat(64) ? value : undefined);
  }
});
