const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, imports, environment = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name];
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    }, process: { env: environment }, Request, Response, Headers, Date, Number, Array, Object, Error,
  });
  return module.exports;
}

class AuthFailure extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const owner = "10000000-0000-4000-8000-000000000001";
const project = "20000000-0000-4000-8000-000000000001";
const id = "30000000-0000-4000-8000-000000000001";
const prefix = `private/owners/${owner}/projects/${project}`;
const entry = {
  id, owner_id: owner, project_id: project,
  staging_key: `${prefix}/staging/${id}`, object_key: `${prefix}/objects/${id}`,
  byte_size: 100, not_before: "2026-01-01T00:00:00.000Z",
};

function cleanupScenario({ rows = [entry], deleteError = false, acknowledged = true, environment = { STORAGE_CLEANUP_ENABLED: "true" } } = {}) {
  const calls = [];
  const config = [];
  const deleted = [];
  const api = load("lib/storage/cleanup.ts", {
    "server-only": {}, "@/lib/auth/security": { AuthFailure },
    inngest: { Inngest: class {
      constructor(options) { config.push(options); }
      createFunction(options, callback) { config.push(options); return { callback }; }
    } },
    "./config": { storageConfig() { calls.push("config"); } },
    "./admin": { storageAdminClient() { return { async rpc(name, values) {
      calls.push([name, values]);
      return { error: null, data: name === "storage_expire_objects" ? 3
        : name === "storage_cleanup_batch" ? rows : acknowledged };
    } }; } },
    "./r2": { createR2Store() { return { async deleteKeys(keys) {
      deleted.push([...keys]);
      if (deleteError) throw new Error("Provider exception details must stay private");
    } }; } },
  }, environment);
  return { api, calls, deleted, config };
}

test("cleanup deletes exact persisted pair, then acknowledges only matching queue ID", async () => {
  const scenario = cleanupScenario();
  const result = await scenario.api.runStorageCleanup();
  assert.equal(result.expired, 3);
  assert.equal(result.deleted, 1);
  assert.deepEqual(scenario.deleted, [[entry.staging_key, entry.object_key]]);
  assert.deepEqual(scenario.calls.slice(1).map(([name]) => name), [
    "storage_expire_objects", "storage_cleanup_batch", "storage_cleanup_done",
  ]);
  assert.equal(scenario.calls.at(-1)[1].p_id, id);
  assert.equal(JSON.stringify(result).includes("private/"), false);
});

test("failed R2 deletion never acknowledges or leaks provider error", async () => {
  const scenario = cleanupScenario({ deleteError: true });
  await assert.rejects(scenario.api.runStorageCleanup(), { message: "Storage cleanup unavailable.", status: 503 });
  assert.equal(scenario.calls.some((call) => Array.isArray(call) && call[0] === "storage_cleanup_done"), false);
});

test("concurrent acknowledgment of already-deleted exact pair is idempotent", async () => {
  const scenario = cleanupScenario({ acknowledged: false });
  assert.equal((await scenario.api.runStorageCleanup()).deleted, 0);
  assert.equal(scenario.deleted.length, 1);
});

for (const [label, changed] of [
  ["foreign owner key", { object_key: entry.object_key.replace(owner, "10000000-0000-4000-8000-000000000002") }],
  ["foreign project key", { staging_key: entry.staging_key.replace(project, "20000000-0000-4000-8000-000000000002") }],
  ["path injection", { object_key: `${prefix}/objects/../${id}` }],
  ["different object ID", { staging_key: `${prefix}/staging/30000000-0000-4000-8000-000000000002` }],
  ["invalid row ID", { id: "../another-account" }],
  ["negative quota amount", { byte_size: -1 }],
  ["future signed-upload grace period", { not_before: "2999-01-01T00:00:00.000Z" }],
  ["invalid deadline", { not_before: "invalid" }],
]) test(`cleanup refuses ${label} before any deletion`, async () => {
  const scenario = cleanupScenario({ rows: [entry, { ...entry, ...changed }] });
  await assert.rejects(scenario.api.runStorageCleanup(), { status: 503 });
  assert.equal(scenario.deleted.length, 0);
});

test("cleanup refuses more than 100 queue entries", async () => {
  const scenario = cleanupScenario({ rows: Array.from({ length: 101 }, () => entry) });
  await assert.rejects(scenario.api.runStorageCleanup(), { status: 503 });
  assert.equal(scenario.deleted.length, 0);
});

test("cleanup switch is required before database or R2 access", async () => {
  const scenario = cleanupScenario({ environment: {} });
  await assert.rejects(scenario.api.runStorageCleanup(), { status: 503 });
  assert.deepEqual(scenario.calls, ["config"]);
  assert.equal(scenario.deleted.length, 0);
});

test("Inngest uses cloud signatures, bounded concurrency, retries, and five-minute cron", () => {
  const scenario = cleanupScenario({ environment: { INNGEST_SIGNING_KEY: "nonsecret-test-fixture" } });
  scenario.api.storageCleanupFunctions();
  assert.equal(scenario.config[0].isDev, false);
  assert.equal(scenario.config[0].signingKey, "nonsecret-test-fixture");
  assert.equal(scenario.config[1].triggers[0].cron, "*/5 * * * *");
  assert.equal(scenario.config[1].concurrency, 1);
  assert.equal(scenario.config[1].retries, 4);
});

function routeScenario(environment = {}, edgeDenied = false, sdkHandler) {
  const calls = [];
  const route = load("app/api/inngest/route.runtime.ts", {
    "inngest/next": { serve() {
      calls.push("serve");
      return sdkHandler ?? (async () => new Response("{}", { status: 401 }));
    } },
    "@/lib/auth/handlers": { authError(error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status ?? 503, headers: { "Cache-Control": "private, no-store" },
      });
    } },
    "@/lib/auth/security": { AuthFailure },
    "@/lib/security/edge-origin": { requireEdgeOrigin() {
      calls.push("edge"); if (edgeDenied) throw new AuthFailure("Protected domain required.", 403);
    } },
    "@/lib/storage/cleanup": { storageCleanupFunctions() { calls.push("functions"); return {}; } },
    "@/lib/storage/config": { storageConfig() { calls.push("config"); } },
    "@/lib/generation/inngest": { generationJobFunctions() { throw new Error("Generation jobs must stay disabled in storage tests"); } },
    "@/lib/billing/inngest": { billingReconciliationFunctions() { throw new Error("Billing reconciliation must stay disabled in storage tests"); } },
  }, environment);
  return { route, calls };
}

test("disabled Inngest route never registers functions or reaches SDK", async () => {
  const scenario = routeScenario();
  const response = await scenario.route.POST(new Request("https://app.example/api/inngest"));
  assert.equal(response.status, 503);
  assert.deepEqual(scenario.calls, ["edge"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

const enabled = { PRIVATE_STORAGE_ENABLED: "true", STORAGE_CLEANUP_ENABLED: "true", INNGEST_SIGNING_KEY: "nonsecret-test-fixture" };
test("Inngest route checks Cloudflare edge before SDK signature verification", async () => {
  const scenario = routeScenario(enabled, true);
  assert.equal((await scenario.route.POST(new Request("https://app.example/api/inngest"))).status, 403);
  assert.deepEqual(scenario.calls, ["edge"]);
});

test("SDK signature rejection stays uncached", async () => {
  const scenario = routeScenario(enabled);
  const response = await scenario.route.POST(new Request("https://app.example/api/inngest"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(scenario.calls, ["edge", "config", "functions", "serve"]);
});

test("installed Inngest SDK rejects actual unsigned execution request", async () => {
  const { Inngest } = require("inngest");
  const { serve } = require("inngest/next");
  const { NextRequest } = require("next/server");
  const client = new Inngest({
    id: "flashloop-storage-security-test", isDev: false,
    signingKey: "signkey-test-" + "01".repeat(32),
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  let executed = false;
  const task = client.createFunction({ id: "cleanup-test", triggers: [{ cron: "*/5 * * * *" }] }, async () => { executed = true; });
  const handler = serve({ client, functions: [task] });
  const response = await handler.POST(new NextRequest("https://app.example/api/inngest?fnId=cleanup-test&stepId=step", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }));
  assert.equal(response.status, 401);
  assert.equal(executed, false);
});
