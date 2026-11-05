const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const sharp = require("sharp");

function load(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module,
    require(name) { assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; },
    Request, Response, URL, TextDecoder, Uint8Array, Buffer, AbortSignal, Object, Number, Error, Set, Date, ...globals,
  });
  return module.exports;
}

const security = load("auth/security.ts");
const ownership = load("ownership/store.ts", { "server-only": {}, "@/lib/auth/security": security, "@/lib/auth/server": {} });
const config = load("storage/config.ts", { "server-only": {}, "@/lib/auth/security": security }, { process: { env: {} } });
const objects = load("storage/objects.ts", {
  "server-only": {}, "@/lib/auth/security": security, "@/lib/ownership/store": ownership, "./config": config,
});
const verification = load("storage/verify.ts", { "server-only": {}, "@/lib/auth/security": security, "./config": config, sharp });
const owner = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const jobId = "30000000-0000-4000-8000-000000000001";
const objectId = "40000000-0000-4000-8000-000000000001";
const otherId = "50000000-0000-4000-8000-000000000001";
const providerUrl = "https://cdn.provider.example/output.png";
const image = sharp({ create: { width: 2, height: 3, channels: 3, background: "green" } }).png().toBuffer();
const defaultPolicy = {
  enabled: true, upload_url_seconds: 120, download_url_seconds: 60,
  max_upload_bytes: 10 * 1024 * 1024, max_account_bytes: 100 * 1024 * 1024,
  retention_days: 7, allowed_content_types: ["image/png", "image/jpeg", "image/webp"],
};

async function scenario(options = {}) {
  const png = await image;
  const events = [];
  const calls = [];
  const job = options.job === null ? null : { id: jobId, owner_id: owner, project_id: projectId, status: "running", ...options.job };
  const base = `private/owners/${owner}/projects/${projectId}`;
  const row = {
    id: objectId, owner_id: owner, project_id: projectId, job_id: jobId,
    kind: "output", filename: "output.png", content_type: "image/png", byte_size: png.length, status: "pending",
    staging_key: `${base}/staging/${objectId}`, object_key: `${base}/objects/${objectId}`,
    upload_expires_at: new Date(Date.now() + 120_000).toISOString(),
    retention_expires_at: new Date(Date.now() + 600_000).toISOString(), etag: null,
    ...options.row,
  };
  const download = { body: png, byteSize: png.length, contentType: "image/png", ...options.download };
  const admin = {
    from(table) {
      assert.equal(table, "jobs");
      const query = { table, filters: [] }; calls.push(query);
      const builder = {
        select(columns) { query.columns = columns; return builder; },
        eq(field, value) { query.filters.push([field, value]); return builder; },
        async maybeSingle() { events.push("readJob"); return { data: job, error: options.jobError ?? null }; },
      };
      return builder;
    },
    async rpc(name, parameters) {
      events.push(name); calls.push({ name, parameters });
      if (name === "storage_policy") return { data: { ...defaultPolicy, ...options.policy }, error: options.policyError ?? null };
      if (name === "storage_reserve_output") return { data: { object: row }, error: options.reserveError ?? null };
      assert.equal(name, "storage_complete_object");
      return { data: { ...row, status: "ready", etag: "verified-etag", ...options.completed }, error: options.completeError ?? null };
    },
  };
  const api = load("storage/outputs.ts", {
    "server-only": {}, "@/lib/auth/security": security, "@/lib/ownership/store": ownership,
    "@/lib/security/provider-destinations": { async fetchProviderOutput(url, fetchOptions) {
      events.push("fetchProviderOutput"); calls.push({ url, fetchOptions });
      if (options.fetchError) throw options.fetchError;
      return download;
    } },
    "./admin": { storageAdminClient() { events.push("adminClient"); return admin; } },
    "./config": { storageConfig() {
      events.push("storageConfig");
      if (options.unconfigured) throw new security.AuthFailure("Private storage is not configured.", 503);
      return {};
    } },
    "./objects": objects,
    "./r2": { createR2Store() {
      events.push("objectStore");
      return { async seal(record, body) {
        events.push("seal"); calls.push({ sealed: record, bodyLength: body.byteLength });
        if (options.sealError) throw options.sealError;
        return "verified-etag";
      } };
    } },
    "./verify": { async verifyImage(...args) { events.push("verifyImage"); return verification.verifyImage(...args); } },
  });
  return { ...api, events, calls, job, row };
}

test("output ingestion derives immutable owner and project from persisted running job", async () => {
  const s = await scenario();
  const result = await s.storeGeneratedImage(jobId, providerUrl, " output.png ");
  assert.equal(result.objectId, objectId);
  assert.equal(result.projectId, projectId);
  const query = s.calls.find((call) => call.table === "jobs");
  assert.equal(query.columns, "id,owner_id,project_id,status");
  assert.equal(query.filters.length, 1);
  assert.equal(query.filters[0][0], "id");
  assert.equal(query.filters[0][1], jobId);
  const reservation = s.calls.find((call) => call.name === "storage_reserve_output").parameters;
  assert.equal(reservation.p_job_id, jobId);
  assert.equal(reservation.p_project_id, projectId);
  assert.equal(reservation.p_owner_id, owner);
  assert.equal(reservation.p_filename, "output.png");
  assert.equal(reservation.p_content_type, "image/png");
  assert.equal(Object.hasOwn(reservation, "p_object_key"), false);
  assert.equal(Object.hasOwn(reservation, "p_staging_key"), false);
  const completion = s.calls.find((call) => call.name === "storage_complete_object").parameters;
  assert.equal(completion.p_id, objectId);
  assert.equal(completion.p_project_id, projectId);
  assert.equal(completion.p_owner_id, owner);
  assert.equal(completion.p_etag, "verified-etag");
});

test("output URL download and real image verification precede reservation and immutable seal", async () => {
  const s = await scenario({ policy: { max_upload_bytes: 1024 * 1024 } });
  await s.storeGeneratedImage(jobId, providerUrl, "output.png");
  const download = s.calls.find((call) => call.fetchOptions);
  assert.equal(download.url, providerUrl);
  assert.equal(download.fetchOptions.maxBytes, 1024 * 1024);
  for (const [earlier, later] of [
    ["readJob", "fetchProviderOutput"], ["storage_policy", "fetchProviderOutput"],
    ["fetchProviderOutput", "verifyImage"], ["verifyImage", "storage_reserve_output"],
    ["storage_reserve_output", "seal"], ["seal", "storage_complete_object"],
  ]) assert.ok(s.events.indexOf(earlier) < s.events.indexOf(later), `${earlier} before ${later}`);
});

for (const status of [null, "queued", "succeeded", "failed", "cancelled"]) test(`output requires running job: ${status}`, async () => {
  const s = await scenario({ job: status === null ? null : { status } });
  await assert.rejects(s.storeGeneratedImage(jobId, providerUrl, "output.png"), { status: 403 });
  assert.equal(s.events.includes("fetchProviderOutput"), false);
  assert.equal(s.events.includes("storage_reserve_output"), false);
  assert.equal(s.events.includes("seal"), false);
});

test("malformed job ID cannot become query injection or alternate account input", async () => {
  const s = await scenario();
  await assert.rejects(s.storeGeneratedImage("../another-owner/job", providerUrl, "output.png"), { status: 400 });
  assert.equal(s.events.includes("readJob"), false);
  assert.equal(s.events.includes("fetchProviderOutput"), false);
  assert.equal(s.events.includes("storage_reserve_output"), false);
});

test("disabled storage and disabled or malformed policy stop before outbound download", async () => {
  for (const options of [
    { unconfigured: true }, { policy: { enabled: false } }, { policy: { enabled: undefined } },
    { policy: { max_upload_bytes: config.MAX_OBJECT_BYTES + 1 } },
  ]) {
    const s = await scenario(options);
    await assert.rejects(s.storeGeneratedImage(jobId, providerUrl, "output.png"), { status: 503 });
    assert.equal(s.events.includes("fetchProviderOutput"), false);
    assert.equal(s.events.includes("storage_reserve_output"), false);
  }
});

test("unapproved provider fetch fails before any storage reservation", async () => {
  const s = await scenario({ fetchError: new security.AuthFailure("Provider destination is not permitted.", 400) });
  await assert.rejects(s.storeGeneratedImage(jobId, "https://unapproved.example/output.png", "output.png"), { status: 400 });
  assert.equal(s.events.includes("storage_reserve_output"), false);
  assert.equal(s.events.includes("objectStore"), false);
});

test("bad MIME, corrupt body, mismatched length, and policy-excluded type never reserve output", async () => {
  const png = await image;
  for (const options of [
    { download: { contentType: "text/html" } },
    { download: { contentType: "image/jpeg" } },
    { download: { body: Buffer.from("corrupt"), byteSize: 7 } },
    { download: { byteSize: png.length + 1 } },
    { policy: { allowed_content_types: ["image/jpeg"] } },
  ]) {
    const s = await scenario(options);
    await assert.rejects(s.storeGeneratedImage(jobId, providerUrl, "output.png"), { status: 400 });
    assert.equal(s.events.includes("storage_reserve_output"), false);
    assert.equal(s.events.includes("seal"), false);
  }
});

test("MIME parameters normalize safely after bounded provider fetch", async () => {
  const s = await scenario({ download: { contentType: "IMAGE/PNG; charset=binary" } });
  await s.storeGeneratedImage(jobId, providerUrl, "output.png");
  assert.equal(s.calls.find((call) => call.name === "storage_reserve_output").parameters.p_content_type, "image/png");
});

test("filename argument cannot inject owner or key fields into worker reservation", async () => {
  const s = await scenario();
  await assert.rejects(s.storeGeneratedImage(jobId, providerUrl, { filename: "output.png", owner_id: otherId, object_key: "../another-account" }), { status: 400 });
  assert.equal(s.events.includes("storage_reserve_output"), false);
  assert.equal(s.events.includes("seal"), false);
});

test("reserved object must match persisted job tuple and server key hierarchy", async () => {
  for (const row of [
    { job_id: otherId }, { project_id: otherId }, { owner_id: otherId }, { kind: "upload" },
    { object_key: "another-account/object" }, { staging_key: "../object" },
  ]) {
    const s = await scenario({ row });
    await assert.rejects(s.storeGeneratedImage(jobId, providerUrl, "output.png"), { status: 503 });
    assert.equal(s.events.includes("seal"), false);
    assert.equal(s.events.includes("storage_complete_object"), false);
  }
});

test("expired reserved output cannot reach immutable sealing", async () => {
  const s = await scenario({ row: { upload_expires_at: new Date(Date.now() - 1000).toISOString() } });
  await assert.rejects(s.storeGeneratedImage(jobId, providerUrl, "output.png"), { status: 410 });
  assert.equal(s.events.includes("storage_reserve_output"), true);
  assert.equal(s.events.includes("objectStore"), false);
  assert.equal(s.events.includes("seal"), false);
  assert.equal(s.events.includes("storage_complete_object"), false);
});

test("completion database errors expose generic failure and never return object success", async () => {
  const s = await scenario({ completeError: { code: "XX000", message: "sensitive database details" } });
  await assert.rejects(s.storeGeneratedImage(jobId, providerUrl, "output.png"), {
    status: 503, message: "Private storage unavailable.",
  });
  assert.equal(s.events.includes("seal"), true);
});

test("non-ready completion and failed immutable seal cannot report successful output", async () => {
  const pending = await scenario({ completed: { status: "pending" } });
  await assert.rejects(pending.storeGeneratedImage(jobId, providerUrl, "output.png"), {
    status: 503, message: "Output completion unavailable.",
  });
  const failedSeal = await scenario({ sealError: new security.AuthFailure("Object completion conflicts with existing content.", 409) });
  await assert.rejects(failedSeal.storeGeneratedImage(jobId, providerUrl, "output.png"), { status: 409 });
  assert.equal(failedSeal.events.includes("storage_complete_object"), false);
});
