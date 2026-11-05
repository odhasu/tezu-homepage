const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, Request, Response, Headers,
    require(name) { assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; },
  });
  return module.exports;
}

function scenario() {
  const pending = [], events = [], errors = [], traces = [];
  let failedSpans = 0;
  const correlation = load("observability/correlation.ts", { "node:crypto": require("node:crypto") });
  const cache = load("http/cache-policy.ts", {});
  const api = load("observability/request.ts", {
    "server-only": {}, "next/server": { after: (callback) => pending.push(callback) },
    "@/lib/analytics/server": { captureAnalytics: async (_request, event, properties) => events.push({ event, properties }) },
    "@/lib/http/cache-policy": cache, "./correlation": correlation,
    "./sentry": {
      traceOperation: async (operation, ids, callback) => { try { return await callback(); } finally { traces.push({ operation, ...ids }); } },
      reportFailure: (operation, ids) => errors.push({ operation, ...ids }),
      markOperationFailed: () => { failedSpans++; }, flushTelemetry: async () => true,
    },
  });
  return { ...api, events, errors, traces, pending, failedSpans: () => failedSpans,
    drain: () => Promise.all(pending.splice(0).map((callback) => callback())) };
}

const generationRequestId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000001";

test("server generates correlation, preserves private response and never consumes request content", async () => {
  const s = scenario();
  const privateValue = "PRIVATE_PASSWORD_AUTH_COOKIE_MEDIA_SIGNED_URL";
  const request = new Request("https://staging.example/api/auth/signup?token=" + privateValue, {
    method: "POST", body: privateValue, headers: { "X-Request-ID": privateValue, cookie: privateValue, authorization: privateValue },
  });
  const response = await s.observeRequest(request, "signup", async () => {
    assert.equal(request.bodyUsed, false);
    return new Response("ok", { headers: { "Set-Cookie": privateValue, Vary: "RSC" } });
  });
  assert.match(response.headers.get("X-Request-ID"), /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("CDN-Cache-Control"), "no-store");
  assert.equal(response.headers.get("Set-Cookie"), privateValue);
  assert.match(response.headers.get("vary"), /RSC/);
  assert.equal(s.events.length, 0);
  await s.drain();
  assert.equal(s.events[0].properties.requestId, response.headers.get("X-Request-ID"));
  assert.equal(JSON.stringify([s.events, s.errors, s.traces]).includes(privateValue), false);
});

test("generation response correlates persisted request and job, excluding all other fields", async () => {
  const s = scenario();
  const response = await s.observeRequest(new Request("https://staging.example/api/generations"), "generation", async () =>
    Response.json({ reservation: { requestId: generationRequestId, jobId, prompt: "PRIVATE PROMPT", requestKey: "PRIVATE KEY" } }, { status: 202 }));
  assert.equal(response.bodyUsed, false);
  await s.drain();
  assert.equal(s.events[0].properties.generationRequestId, generationRequestId);
  assert.equal(s.events[0].properties.jobId, jobId);
  assert.equal(s.traces[0].jobId, jobId);
  assert.equal(JSON.stringify([s.events, s.traces]).includes("PRIVATE"), false);
});

test("denied generation never accepts job identifiers, and emits authorization/quota outcomes", async () => {
  for (const status of [403, 402, 429]) {
    const s = scenario();
    await s.observeRequest(new Request("https://staging.example/api/generations"), "generation", async () =>
      Response.json({ reservation: { requestId: generationRequestId, jobId } }, { status }));
    await s.drain();
    assert.equal(s.events[0].properties.jobId, undefined);
    assert.ok(s.events.some(({ event }) => event === (status === 403 ? "authorization" : "quota_rejection")));
  }
});

test("unexpected exceptions produce fixed private failure and correlated error without thrown content", async () => {
  const s = scenario();
  const response = await s.observeRequest(new Request("https://staging.example/api/account"), "authorization", async () => {
    throw new Error("PRIVATE_COOKIE_SIGNED_URL_PROMPT");
  });
  assert.equal(response.status, 503);
  assert.equal(s.failedSpans(), 1);
  assert.equal(s.errors[0].requestId, response.headers.get("X-Request-ID"));
  await s.drain();
  assert.equal(JSON.stringify([await response.json(), s.events, s.errors, s.traces]).includes("PRIVATE"), false);
});

test("simultaneous account requests each authorize and retain independent IDs", async () => {
  const s = scenario();
  const authorized = [];
  const replies = await Promise.all(["A", "B"].map((account) =>
    s.observeRequest(new Request("https://staging.example/api/account", { headers: { cookie: account } }), "authorization", async () => {
      authorized.push(account);
      await new Promise((resolve) => setTimeout(resolve, account === "A" ? 5 : 0));
      return Response.json({ account });
    })));
  assert.deepEqual(authorized, ["A", "B"]);
  assert.notEqual(replies[0].headers.get("X-Request-ID"), replies[1].headers.get("X-Request-ID"));
  assert.deepEqual(await replies[0].json(), { account: "A" });
  assert.deepEqual(await replies[1].json(), { account: "B" });
  await s.drain();
  assert.equal(new Set(s.events.map(({ properties }) => properties.requestId)).size, 2);
  assert.equal(s.events.some(({ properties }) => "account" in properties), false);
});

test("auth operation names never copy arbitrary URL path segments into telemetry", () => {
  const s = scenario();
  assert.equal(s.authOperation("callback"), "verification");
  assert.equal(s.authOperation("verify"), "verification");
  assert.equal(s.authOperation("PRIVATE_PATH"), "authorization");
});
