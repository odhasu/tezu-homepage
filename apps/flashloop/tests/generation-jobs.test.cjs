const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports, environment = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name]; assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; },
    process: { env: environment }, Date, Number, Array, Object, String, Error, Set, RegExp, Promise, TextEncoder,
  });
  return module.exports;
}
const security = load("lib/auth/security.ts", {});
const owner = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const reservationId = "30000000-0000-4000-8000-000000000001";
const projectId = "40000000-0000-4000-8000-000000000001";
const jobId = "50000000-0000-4000-8000-000000000001";
const requestKey = "generation-fixture-0001";
const idempotencyKey = `flashloop:${reservationId}`;

function scenario(options = {}) {
  let status = options.status ?? "reserved";
  const calls = [], paid = [], reconciliations = [], events = [];
  const row = () => ({ requestId, userId: owner, requestKey, projectId, jobId, provider: "fixture", status,
    providerJobId: status === "dispatched" ? "paid-job-1" : null, providerIdempotencyKey: idempotencyKey });
  const record = () => ({ ...row(), reservationId, priceKey: "video.fixture", currency: "USD", outcome: null,
    creditsReserved: 10, worstCaseCostMicros: 100, heldCostMicros: 100, actualCostMicros: null, spendDay: "2026-11-05", settledDay: null });
  const admin = { async rpc(name, args) {
    calls.push({ name, args });
    if (options.failRpc === name) throw new Error("SECRET database diagnostic");
    let data;
    if (name === "generation_job_context") data = options.unknown ? null : { ...row(), ...options.context };
    if (name === "generation_dispatch_batch") data = options.rows ?? [row()];
    if (name === "generation_dispatch_sent") data = true;
    if (name === "generation_bind_reconciled_job") { status = "dispatched"; data = row(); }
    if (name === "apply_generation_callback") { status = "committed"; data = { applied: true, duplicate: false, status, requestId, jobId }; }
    if (name === "claim_generation") {
      const winner = status === "reserved";
      if (winner) status = "dispatching";
      data = { ...record(), dispatchAllowed: winner,
        ...(winner ? { providerRequest: { prompt: "PRIVATE stored prompt", profile: { provider: "fixture", model: "stored-bounded" } } } : {}) };
    }
    if (name === "mark_generation_dispatched") { status = "dispatched"; data = { ...record(), providerJobId: "paid-job-1" }; }
    if (name === "mark_generation_unknown") { status = "unknown"; data = record(); }
    return { data, error: null };
  } };
  const adapter = {
    id: "fixture",
    async dispatch(input) { paid.push(input); if (options.timeout) throw new Error("SECRET provider response"); return { providerJobId: "paid-job-1" }; },
    async reconcile(input) { reconciliations.push(input); if (options.reconcileError) throw new Error("SECRET lookup error"); return options.reconciled ?? null; },
  };
  const entitlement = load("lib/entitlements/service.ts", {
    "server-only": {}, "@/lib/auth/security": security, "@/lib/auth/server": {},
  });
  const providers = { generationAdapter() { if (options.noAdapter) throw new security.AuthFailure("Provider unavailable.", 503); return adapter; }, generationAdaptersReady: () => !options.noAdapter };
  const webhooks = load("lib/generation/webhooks.ts", { "server-only": {}, "node:crypto": require("node:crypto"), "@/lib/auth/security": security });
  const telemetry = [];
  const api = load("lib/generation/jobs.ts", { "server-only": {}, "@/lib/auth/security": security, "@/lib/entitlements/service": entitlement,
    "./providers": providers, "./webhooks": webhooks,
    "@/lib/observability/sentry": {
      async traceOperation(operation, ids, callback) { try { return await callback(); } finally { telemetry.push({ operation, ...ids }); } },
      flushTelemetry: async () => false,
    },
  }, options.environment);
  return { api, admin, adapter, calls, paid, reconciliations, row, telemetry, status: () => status,
    send: async (event) => { events.push(event); if (options.sendError) throw new Error("SECRET send error"); }, events };
}

test("restarted/concurrent workers use persisted inputs and one paid claim", async () => {
  const s = scenario();
  await Promise.all([s.api.executeGenerationJob(s.admin, requestId), s.api.executeGenerationJob(s.admin, requestId)]);
  await s.api.executeGenerationJob(s.admin, requestId);
  assert.equal(s.paid.length, 1);
  assert.equal(s.paid[0].prompt, "PRIVATE stored prompt");
  assert.equal(s.paid[0].profile.model, "stored-bounded");
  assert.equal(s.paid[0].idempotencyKey, idempotencyKey);
  assert.equal(s.status(), "dispatched");
});

test("ambiguous paid response retries only read-only reconciliation; never refund or redispatch", async () => {
  const s = scenario({ timeout: true });
  await assert.rejects(s.api.executeGenerationJob(s.admin, requestId), /unknown/);
  const result = await s.api.executeGenerationJob(s.admin, requestId);
  assert.equal(result.status, "awaiting_reconciliation");
  assert.equal(s.paid.length, 1);
  assert.equal(s.reconciliations.length, 1);
  assert.equal(s.calls.some(({ name }) => name === "release_generation"), false);
});

test("restart after claim but before send cannot create another paid operation", async () => {
  const s = scenario({ status: "dispatching" });
  await s.api.executeGenerationJob(s.admin, requestId);
  await s.api.executeGenerationJob(s.admin, requestId);
  assert.equal(s.paid.length, 0);
  assert.equal(s.reconciliations.length, 2);
});

test("authoritative lookup recovers persisted provider ID without dispatch", async () => {
  const s = scenario({ status: "unknown", reconciled: { providerJobId: "paid-job-1" } });
  assert.equal((await s.api.executeGenerationJob(s.admin, requestId)).status, "dispatched");
  assert.equal(s.paid.length, 0);
  assert.equal(s.calls.at(-1).name, "generation_bind_reconciled_job");
  assert.equal(s.calls.at(-1).args.p_provider, "fixture");
});

test("lost acceptance persistence retains claim and does not resubmit", async () => {
  const s = scenario({ failRpc: "mark_generation_dispatched" });
  await assert.rejects(s.api.executeGenerationJob(s.admin, requestId));
  await s.api.executeGenerationJob(s.admin, requestId);
  assert.equal(s.paid.length, 1);
  assert.equal(s.status(), "unknown");
});

test("lost claim response does not dispatch", async () => {
  const s = scenario({ failRpc: "claim_generation" });
  await assert.rejects(s.api.executeGenerationJob(s.admin, requestId));
  assert.equal(s.paid.length, 0);
});

test("unknown jobs and terminal reservations cannot dispatch", async () => {
  for (const options of [{ unknown: true }, ...["committed", "released", "reconciliation_required"].map((status) => ({ status }))]) {
    const s = scenario(options);
    await s.api.executeGenerationJob(s.admin, requestId);
    assert.equal(s.paid.length, 0);
    assert.equal(s.reconciliations.length, 0);
  }
});

test("lost callback settles through authoritative API lookup without another paid send", async () => {
  for (const status of ["unknown", "dispatched"]) {
    const s = scenario({ status, reconciled: { providerJobId: "paid-job-1", callback: {
      eventId: "provider-api-observation", providerJobId: "paid-job-1", outcome: "succeeded", actualCostMicros: 80, timestamp: new Date(),
    } } });
    assert.equal((await s.api.executeGenerationJob(s.admin, requestId)).status, "committed");
    assert.equal(s.paid.length, 0);
    const callback = s.calls.find(({ name }) => name === "apply_generation_callback");
    assert.match(callback.args.p_event_id, /^reconciliation:[a-f0-9]{64}$/);
    assert.equal(callback.args.p_actual_cost_micros, 80);
    assert.equal(s.calls.some(({ name }) => name === "claim_generation"), false);
  }
});

test("reconciliation cannot bind a different accepted job or settle foreign evidence", async () => {
  for (const options of [
    { status: "dispatched", reconciled: { providerJobId: "different-job" } },
    { status: "unknown", reconciled: { providerJobId: "paid-job-1", callback: {
      eventId: "foreign-result", providerJobId: "foreign-job", outcome: "succeeded", actualCostMicros: 80, timestamp: new Date(),
    } } },
  ]) {
    const s = scenario(options);
    await assert.rejects(s.api.executeGenerationJob(s.admin, requestId));
    assert.equal(s.paid.length, 0);
    assert.equal(s.calls.some(({ name }) => name === "apply_generation_callback"), false);
  }
});

test("malformed or ownership-injecting events fail before database access", () => {
  const s = scenario();
  assert.equal(s.api.generationRequestId({ requestId }), requestId);
  for (const input of [null, [], {}, { requestId: "bad" }, { requestId, userId: owner }, { requestId, prompt: "replacement" }]) {
    assert.throws(() => s.api.generationRequestId(input), { status: 400 });
  }
  assert.equal(s.calls.length, 0);
});

test("context identity mismatch and missing adapter fail before a paid claim", async () => {
  for (const options of [{ context: { requestId: projectId } }, { noAdapter: true }]) {
    const s = scenario(options);
    await assert.rejects(s.api.executeGenerationJob(s.admin, requestId));
    assert.equal(s.calls.some(({ name }) => name === "claim_generation"), false);
  }
});

test("outbox send precedes acknowledgment; repeated delivery uses same stable ID", async () => {
  const s = scenario();
  await s.api.publishGenerationOutbox(s.admin, s.send);
  await s.api.publishGenerationOutbox(s.admin, s.send);
  assert.equal(s.events[0].id, s.events[1].id);
  assert.deepEqual(Object.keys(s.events[0].data), ["requestId"]);
  assert.equal(s.calls[1].name, "generation_dispatch_sent");
  assert.equal(JSON.stringify(s.events).includes("PRIVATE"), false);
});

test("failed event send leaves outbox unacknowledged and hides provider diagnostics", async () => {
  const s = scenario({ sendError: true });
  await assert.rejects(s.api.publishGenerationOutbox(s.admin, s.send), { message: "Generation jobs unavailable.", status: 503 });
  assert.equal(s.calls.some(({ name }) => name === "generation_dispatch_sent"), false);
});

test("lost outbox acknowledgment repeats only same event identity", async () => {
  const s = scenario({ failRpc: "generation_dispatch_sent" });
  for (let i = 0; i < 2; i++) await assert.rejects(s.api.publishGenerationOutbox(s.admin, s.send));
  assert.equal(s.events[0].id, s.events[1].id);
});

test("reconciliation events escape transport dedupe in later five-minute windows", async () => {
  const s = scenario({ status: "unknown" });
  await s.api.publishGenerationOutbox(s.admin, s.send, 0);
  await s.api.publishGenerationOutbox(s.admin, s.send, 300_000);
  assert.notEqual(s.events[0].id, s.events[1].id);
  assert.equal(s.events[0].data.requestId, requestId);
});

test("unclaimed reservations redeliver after exhausted transport retries", async () => {
  const s = scenario();
  await s.api.publishGenerationOutbox(s.admin, s.send, 0);
  await s.api.publishGenerationOutbox(s.admin, s.send, 300_000);
  assert.notEqual(s.events[0].id, s.events[1].id);
  assert.equal(s.paid.length, 0);
});

test("missing provider does not acknowledge outbox", async () => {
  const s = scenario({ noAdapter: true });
  await assert.rejects(s.api.publishGenerationOutbox(s.admin, s.send));
  assert.equal(s.events.length, 0);
});

test("every enablement prerequisite is required", () => {
  const complete = { GENERATION_JOBS_ENABLED: "true", INNGEST_EVENT_KEY: "test-event", INNGEST_SIGNING_KEY: "test-signing" };
  scenario({ environment: complete }).api.requireGenerationJobs();
  for (const key of Object.keys(complete)) {
    assert.throws(() => scenario({ environment: { ...complete, [key]: "" } }).api.requireGenerationJobs(), { status: 503 });
  }
  assert.throws(() => scenario({ environment: complete, noAdapter: true }).api.requireGenerationJobs(), { status: 503 });
});

test("lookup transport errors are generic and leave ambiguous state held", async () => {
  const s = scenario({ status: "unknown", reconcileError: true });
  await assert.rejects(s.api.executeGenerationJob(s.admin, requestId), { message: "Generation jobs unavailable.", status: 503 });
  assert.equal(s.status(), "unknown");
  assert.equal(s.paid.length, 0);
});

test("Inngest registers durable outbox and bounded worker; malformed event never reaches step", async () => {
  const s = scenario({ environment: { GENERATION_JOBS_ENABLED: "true", INNGEST_EVENT_KEY: "test-event", INNGEST_SIGNING_KEY: "test-signing" } });
  const configurations = [], steps = [];
  class NonRetriableError extends Error {}
  const api = load("lib/generation/inngest.ts", {
    "server-only": {},
    inngest: { NonRetriableError, Inngest: class {
      constructor(config) { configurations.push(config); }
      createFunction(config, callback) { configurations.push(config); return { callback }; }
      send(event) { return s.send(event); }
    } },
    "@/lib/storage/admin": { storageAdminClient: () => s.admin }, "./jobs": s.api,
  }, { INNGEST_EVENT_KEY: "test-event", INNGEST_SIGNING_KEY: "test-signing" });
  const functions = api.generationJobFunctions();
  assert.equal(configurations[0].isDev, false);
  assert.equal(configurations[0].id, "flashloop-private-storage");
  assert.equal(configurations[1].triggers[0].cron, "* * * * *");
  assert.equal(configurations[1].concurrency, 1);
  assert.equal(configurations[2].concurrency[0].limit, 1);
  assert.equal(configurations[2].concurrency[1].key, "event.data.requestId");
  const step = { async run(name, callback) { steps.push(name); return callback(); } };
  await assert.rejects(functions.functions[1].callback({ event: { data: { requestId, userId: owner } }, step }), NonRetriableError);
  assert.equal(steps.length, 0);
  const result = await functions.functions[1].callback({ event: { data: { requestId } }, step });
  assert.deepEqual(Object.keys(result), ["status"]);
  assert.equal(s.paid.length, 1);
});

test("installed Inngest SDK rejects forged, expired, and future signatures before execution", async () => {
  const { createHmac } = require("node:crypto");
  const { Inngest } = require("inngest");
  const { serve } = require("inngest/next");
  const { NextRequest } = require("next/server");
  const key = "ab".repeat(32);
  let executions = 0;
  const client = new Inngest({ id: "flashloop-jobs-signature-test", isDev: false,
    signingKey: `signkey-test-${key}`, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  const task = client.createFunction({ id: "signed-only", triggers: [{ event: "flashloop/generation.requested" }] }, async () => { executions++; });
  const handler = serve({ client, functions: [task] });
  const now = Math.floor(Date.now() / 1000);
  for (const [timestamp, signingKey] of [[now, "wrong-test-key"], [now - 600, key], [now + 600, key]]) {
    const body = "{}";
    const signature = createHmac("sha256", signingKey).update(body + timestamp).digest("hex");
    const response = await handler.POST(new NextRequest("https://app.example/api/inngest?fnId=signed-only&stepId=step", {
      method: "POST", headers: { "content-type": "application/json", "x-inngest-signature": `t=${timestamp}&s=${signature}` }, body,
    }));
    assert.equal(response.status, 401);
  }
  assert.equal(executions, 0);
});


test("job tracing adds only persisted safe correlation after context validation", async () => {
  const s = scenario();
  await s.api.executeGenerationJob(s.admin, requestId);
  const span = s.telemetry[0];
  assert.equal(span.operation, "generation_job");
  assert.equal(span.generationRequestId, requestId);
  assert.equal(span.jobId, jobId);
  assert.match(span.requestId, /^[0-9a-f-]{36}$/);
  assert.notEqual(span.requestId, requestId);
  assert.deepEqual(Object.keys(span).sort(), ["generationRequestId", "jobId", "operation", "requestId"]);
  assert.equal(JSON.stringify(span).includes(owner), false);
  assert.equal(JSON.stringify(span).includes("PRIVATE"), false);
});

test("unknown or forged job context cannot add event-selected IDs to tracing", async () => {
  for (const options of [{ unknown: true }, { context: { requestId: "90000000-0000-4000-8000-000000000001" } }]) {
    const s = scenario(options);
    if (options.unknown) await s.api.executeGenerationJob(s.admin, requestId);
    else await assert.rejects(s.api.executeGenerationJob(s.admin, requestId));
    assert.equal(s.telemetry[0].generationRequestId, undefined);
    assert.equal(s.telemetry[0].jobId, undefined);
    assert.equal(s.paid.length, 0);
  }
});
