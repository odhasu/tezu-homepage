const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const owner = "10000000-0000-4000-8000-000000000001";
const project = "40000000-0000-4000-8000-000000000001";
const session = "50000000-0000-4000-8000-000000000001";
const origin = "https://example.invalid";
const input = { projectId: project, requestKey: "request-key-0000001", priceKey: "video.standard", prompt: "Fixture prompt" };
const record = {
  requestId: "20000000-0000-4000-8000-000000000001", requestKey: input.requestKey,
  reservationId: "30000000-0000-4000-8000-000000000001", projectId: project,
  jobId: "60000000-0000-4000-8000-000000000001", priceKey: input.priceKey,
  currency: "USD", outcome: null, status: "reserved", creditsReserved: 10,
  worstCaseCostMicros: 100, heldCostMicros: 100, actualCostMicros: null,
  spendDay: "2026-11-04", settledDay: null, providerJobId: null,
  providerIdempotencyKey: "flashloop:30000000-0000-4000-8000-000000000001",
};
function load(file, imports) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name];
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    }, Request, Response, URL, TextDecoder, Uint8Array, Object, Array, Number, String, Error, JSON, Set, RegExp,
  });
  return module.exports;
}
const security = load("lib/auth/security.ts", {});
function scenario(options = {}) {
  const calls = [];
  let status = "reserved";
  const query = async (name, args) => {
    calls.push({ name, args });
    if (options.error) return { error: options.error };
    if (options.failClaim && name === "claim_generation") { status = "dispatching"; throw new Error("lost database response"); }
    if (options.failUnknown && name === "mark_generation_unknown") throw new Error("database offline");
    if (name === "claim_generation") {
      const winner = status === "reserved";
      if (winner) status = "dispatching";
      return { data: { ...record, status, dispatchAllowed: winner,
        ...(winner ? { providerRequest: { profile: { provider: "fixture", model: "fixed" }, prompt: input.prompt } } : {}),
      }, error: null };
    }
    if (name === "mark_generation_dispatched") status = "dispatched";
    if (name === "mark_generation_unknown") status = "unknown";
    return { data: { ...record, status }, error: null };
  };
  const user = { rpc: query };
  const admin = { rpc: query };
  const auth = {
    assertUserDataClient: (candidate) => assert.equal(candidate, user),
    requireProtectedSession: async () => {
      calls.push({ name: "authorize" });
      if (options.noSession) throw new security.AuthFailure("Sign in.", 401);
      return { user_id: owner, session_id: session };
    },
  };
  const api = load("lib/entitlements/service.ts", {
    "server-only": {}, "@/lib/auth/server": auth, "@/lib/auth/security": security,
  });
  return { calls, api, user, admin, status: () => status, service: api.createEntitlementService({ user, admin }) };
}

test("website checks live session before RPC; subject and pricing stay in database", async () => {
  const s = scenario();
  await s.service.reserveForUser(input);
  assert.equal(s.calls[0].name, "authorize");
  const call = s.calls[1];
  assert.equal(call.name, "reserve_generation");
  assert.equal(call.args.p_project_id, project);
  assert.equal(call.args.p_prompt, input.prompt);
  assert.equal(call.args.p_user_id, undefined);
  assert.equal(call.args.p_credits, undefined);
  assert.equal(call.args.p_worst_case_cost_micros, undefined);
  const denied = scenario({ noSession: true });
  await assert.rejects(denied.service.reserveForUser(input), { status: 401 });
  assert.equal(denied.calls.length, 1);
});

test("worker new reservation requires original verified session as well as owner", async () => {
  const s = scenario();
  await s.service.reserveForWorker(owner, session, input);
  assert.equal(s.calls[0].name, "reserve_generation_for_user");
  assert.equal(s.calls[0].args.p_session_id, session);
  await assert.rejects(s.service.reserveForWorker(owner, "missing", input), { status: 400 });
});

test("quota and credit rejections map to bounded application errors", async () => {
  for (const [message, status] of [["Insufficient video credits", 402], ["Account daily spend cap reached", 429], ["Generation kill switch is enabled", 503]]) {
    const s = scenario({ error: { code: "P0001", message } });
    await assert.rejects(s.service.reserveForWorker(owner, session, input), { status });
  }
});

test("invalid request key or prompt fails before database mutation", async () => {
  const s = scenario();
  await assert.rejects(s.service.reserveForWorker(owner, session, { ...input, requestKey: "short" }), { status: 400 });
  await assert.rejects(s.service.reserveForWorker(owner, session, { ...input, prompt: "" }), { status: 400 });
  assert.equal(s.calls.length, 0);
});

test("one persisted claim permits one provider call, replay does not dispatch", async () => {
  const s = scenario();
  let sends = 0;
  const provider = { async dispatch(value) {
    assert.equal(s.status(), "dispatching");
    assert.equal(value.idempotencyKey, record.providerIdempotencyKey);
    assert.equal(value.prompt, input.prompt);
    assert.equal(value.profile.model, "fixed");
    sends++;
    return { providerJobId: "provider-fixture-1" };
  } };
  const results = await Promise.all([s.service.dispatchReserved(owner, input.requestKey, provider), s.service.dispatchReserved(owner, input.requestKey, provider)]);
  assert.equal(sends, 1);
  assert.ok(results.some((result) => result.status === "dispatched"));
  assert.equal(s.calls.some((call) => call.name === "release_generation"), false);
});

test("provider timeout retains reservation and suppresses automatic redispatch/refund", async () => {
  const s = scenario();
  let sends = 0;
  const provider = { async dispatch() { sends++; throw new Error("provider accepted but reply lost"); } };
  await assert.rejects(s.service.dispatchReserved(owner, input.requestKey, provider), { status: 503 });
  assert.equal(s.status(), "unknown");
  const replay = await s.service.dispatchReserved(owner, input.requestKey, provider);
  assert.equal(replay.status, "unknown");
  assert.equal(sends, 1);
  assert.equal(s.calls.some((call) => call.name === "release_generation"), false);
});

test("lost claim response or failed unknown write cannot issue another provider send", async () => {
  const lost = scenario({ failClaim: true });
  let sends = 0;
  await assert.rejects(lost.service.dispatchReserved(owner, input.requestKey, { async dispatch() { sends++; return { providerJobId: "never" }; } }), { status: 503 });
  assert.equal(sends, 0);
  assert.equal(lost.status(), "dispatching");
  const failedWrite = scenario({ failUnknown: true });
  await assert.rejects(failedWrite.service.dispatchReserved(owner, input.requestKey, { async dispatch() { throw new Error("timeout"); } }), { status: 503 });
  assert.equal(failedWrite.status(), "dispatching");
  assert.equal(failedWrite.calls.some((call) => call.name === "release_generation"), false);
});

test("reconciliation passes explicit provider outcome and cost only to worker RPC", async () => {
  const s = scenario();
  await s.service.resolve({ userId: owner, requestKey: input.requestKey, actualCostMicros: 20, outcome: "failed" });
  assert.equal(s.calls[0].name, "resolve_generation");
  assert.equal(s.calls[0].args.p_actual_cost_micros, 20);
  assert.equal(s.calls[0].args.p_outcome, "failed");
});

function handler(s) {
  return load("app/api/generations/route.runtime.ts", {
    "@/lib/auth/server": { authClients: async () => ({ client: s.user, admin: s.admin, config: { origin } }) },
    "@/lib/auth/security": security,
    "@/lib/auth/handlers": {
      authJson: (data, status) => Response.json(data, { status, headers: { "cache-control": "private, no-store" } }),
      authError: (error) => Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "private, no-store" } }),
    },
    "@/lib/entitlements/service": s.api,
    "@/lib/security/edge-origin": { requireEdgeOrigin() {} },
  });
}
function request(body, headers = {}) {
  return new Request(`${origin}/api/generations`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-requested-with": "flashloop", ...headers }, body: JSON.stringify(body),
  });
}

test("actual Route Handler refuses caller pricing/options and cross-site requests", async () => {
  for (const extra of [{ credits: 1 }, { worstCaseCostMicros: 1 }, { parameters: { duration: 10000 } }, { ownerId: owner }]) {
    const s = scenario();
    const response = await handler(s).POST(request({ ...input, ...extra }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(s.calls.length, 0);
  }
  const s = scenario();
  assert.equal((await handler(s).POST(request(input, { origin: "https://attacker.invalid" }))).status, 403);
  assert.equal(s.calls.length, 0);
});

test("reservation and zero-credit HTTP responses are private no-store; no provider dispatch", async () => {
  for (const [options, expected] of [[{}, 202], [{ error: { code: "P0001", message: "Insufficient video credits" } }, 402]]) {
    const s = scenario(options);
    const response = await handler(s).POST(request(input));
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(s.calls.some((call) => call.name === "claim_generation"), false);
  }
});
