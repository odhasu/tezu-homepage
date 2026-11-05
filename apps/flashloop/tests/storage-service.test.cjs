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
    Request, Response, Headers, URL, TextDecoder, Uint8Array, Buffer, AbortSignal,
    Object, Number, Error, Set, Date, ...globals,
  });
  return module.exports;
}

const security = load("auth/security.ts");
const config = load("storage/config.ts", { "server-only": {}, "@/lib/auth/security": security }, { process: { env: {} } });
const ownership = load("ownership/store.ts", {
  "server-only": {}, "@/lib/auth/security": security, "@/lib/auth/server": {},
});
const objects = load("storage/objects.ts", {
  "server-only": {}, "@/lib/auth/security": security, "@/lib/ownership/store": ownership, "./config": config,
});
const verification = load("storage/verify.ts", {
  "server-only": {}, "@/lib/auth/security": security, "./config": config, sharp,
});
const owner = "10000000-0000-4000-8000-000000000001";
const otherOwner = "10000000-0000-4000-8000-000000000002";
const project = "20000000-0000-4000-8000-000000000001";
const objectId = "30000000-0000-4000-8000-000000000001";
const origin = "https://app.example";
const image = sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
const policy = {
  enabled: true, upload_url_seconds: 120, download_url_seconds: 60,
  max_upload_bytes: config.MAX_OBJECT_BYTES, max_account_bytes: 100 * 1024 * 1024,
  retention_days: 7, allowed_content_types: ["image/png", "image/jpeg", "image/webp"],
};

function storedRow(overrides = {}) {
  const base = `private/owners/${owner}/projects/${project}`;
  return {
    id: objectId, owner_id: owner, project_id: project, job_id: null, kind: "upload", filename: "image.png",
    content_type: "image/png", byte_size: 100, status: "pending",
    staging_key: `${base}/staging/${objectId}`, object_key: `${base}/objects/${objectId}`,
    upload_expires_at: new Date(Date.now() + 120_000).toISOString(),
    retention_expires_at: new Date(Date.now() + 600_000).toISOString(), etag: null,
    ...overrides,
  };
}

test("actual Sharp decodes supported PNG, JPEG, and WebP pixel data", async () => {
  for (const [format, contentType] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["webp", "image/webp"]]) {
    const bytes = await sharp({ create: { width: 3, height: 4, channels: 3, background: "blue" } })[format]().toBuffer();
    await verification.verifyImage(bytes, contentType, bytes.length);
  }
});

test("actual Sharp rejects corrupt, MIME-mismatched, truncated, and unsupported images", async () => {
  const png = await image;
  for (const [bytes, contentType] of [
    [Buffer.from("not an image"), "image/png"], [png, "image/jpeg"],
    [png.subarray(0, png.length - 20), "image/png"], [Buffer.from("<svg width='1' height='1'></svg>"), "image/svg+xml"],
  ]) await assert.rejects(verification.verifyImage(bytes, contentType, bytes.length), { status: 400 });
});

test("actual Sharp rejects animated WebP pages and oversized pixel dimensions", async () => {
  const animated = await sharp(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), {
    raw: { width: 1, height: 2, channels: 4, pageHeight: 1 },
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(verification.verifyImage(animated, "image/webp", animated.length), { status: 400 });
  const largePixels = await sharp({ create: { width: 8000, height: 5001, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(verification.verifyImage(largePixels, "image/png", largePixels.length), { status: 400 });
});

test("reservation byte limit and exact uploaded length are checked before decoding", async () => {
  const png = await image;
  await assert.rejects(verification.verifyImage(png, "image/png", png.length + 1), { status: 400 });
  const tooLarge = Buffer.alloc(config.MAX_OBJECT_BYTES + 1);
  await assert.rejects(verification.verifyImage(tooLarge, "image/png", tooLarge.length), { status: 400 });
});

test("upload fields accept only bounded raster metadata, never caller identity or storage keys", () => {
  const body = { filename: " image.png ", content_type: "image/png", byte_size: 10 };
  assert.equal(objects.uploadFields(body).filename, "image.png");
  for (const patch of [
    { owner_id: owner }, { project_id: project }, { object_key: "another-account/key" },
    { staging_key: "../replace" }, { bucket: "public-assets" }, { id: objectId },
    { byte_size: 0 }, { byte_size: -1 }, { byte_size: 1.1 }, { byte_size: "10" },
    { byte_size: config.MAX_OBJECT_BYTES + 1 }, { content_type: "text/html" },
    { filename: "x\n.png" }, { filename: "" },
  ]) assert.throws(() => objects.uploadFields({ ...body, ...patch }), { status: 400 });
});

test("persisted key validation enforces exact owner/project/object hierarchy", () => {
  assert.equal(objects.projectObject(storedRow()).id, objectId);
  for (const patch of [
    { object_key: "another-account/key" }, { staging_key: "../key" }, { owner_id: otherOwner },
    { object_key: `${storedRow().object_key}/../other` }, { byte_size: config.MAX_OBJECT_BYTES + 1 },
    { content_type: "image/svg+xml" }, { status: "unreviewed" }, { upload_expires_at: "invalid" },
  ]) assert.throws(() => objects.projectObject(storedRow(patch)), { status: 503 });
});

test("policy bounds and expiry fail closed", () => {
  assert.equal(objects.storagePolicy(policy).download_url_seconds, 60);
  for (const patch of [
    { enabled: false }, { enabled: undefined }, { upload_url_seconds: 29 }, { upload_url_seconds: 901 }, { download_url_seconds: 0 },
    { max_upload_bytes: config.MAX_OBJECT_BYTES + 1 }, { max_account_bytes: 1 },
    { retention_days: 0 }, { retention_days: 366 }, { allowed_content_types: ["text/html"] },
  ]) assert.throws(() => objects.storagePolicy({ ...policy, ...patch }), { status: 503 });
  assert.equal(objects.remainingSeconds("2026-11-04T12:02:00Z", 60, Date.parse("2026-11-04T12:00:00Z")), 60);
  for (const deadline of ["invalid", "2026-11-04T11:59:59Z", "2026-11-04T12:00:00.999Z"]) {
    assert.throws(() => objects.remainingSeconds(deadline, 60, Date.parse("2026-11-04T12:00:00Z")), { status: 410 });
  }
});

function scenario(options = {}) {
  const calls = [];
  const events = [];
  const row = storedRow(options.row);
  let sessionChecks = 0;
  let objectStoreCalls = 0;
  const client = {
    from(table) {
      const query = { table, filters: [] }; calls.push(query);
      const builder = {
        select() { return builder; },
        eq(key, value) { query.filters.push([key, value]); return builder; },
        async maybeSingle() {
          if (table === "projects") return { data: options.parent === false ? null : { id: project }, error: null };
          return { data: options.found === false ? null : row, error: null };
        },
      };
      return builder;
    },
    async rpc(name, parameters) {
      calls.push({ role: "user", name, parameters }); events.push(name);
      if (name === "reserve_project_upload") return { data: { object: row, policy: { ...policy, ...options.policy } }, error: options.reserveError ?? null };
      assert.equal(name, "delete_project_object");
      return { data: true, error: null };
    },
  };
  const admin = {
    async rpc(name, parameters) {
      calls.push({ role: "admin", name, parameters }); events.push(name);
      if (name === "storage_policy") return { data: { ...policy, ...options.policy }, error: null };
      assert.equal(name, "storage_complete_object");
      return { data: { ...row, status: "ready", etag: "verified-etag" }, error: null };
    },
  };
  const store = {
    async uploadUrl(record, seconds) { events.push("uploadUrl"); calls.push({ record, seconds, sign: "upload" }); return "signed-upload"; },
    async downloadUrl(record, seconds) { events.push("downloadUrl"); calls.push({ record, seconds, sign: "download" }); return "signed-download"; },
    async readStaging(record) { events.push("readStaging"); assert.equal(record.id, objectId); return options.bytes ?? image; },
    async seal(record, bytes) { events.push("seal"); assert.equal(record.id, objectId); assert.equal(bytes.byteLength, row.byte_size); return "verified-etag"; },
  };
  const serviceModule = load("storage/service.ts", {
    "server-only": {}, "@/lib/auth/security": security, "@/lib/ownership/store": ownership,
    "@/lib/auth/server": {
      assertUserDataClient(candidate) {
        if (candidate !== client) throw new security.AuthFailure("Invalid user client.", 503);
      },
      async requireProtectedSession(context) {
        sessionChecks++;
        assert.equal(context.client, client);
        assert.equal(context.admin, undefined);
        if (options.session === false || (options.revokeAfter && sessionChecks > options.revokeAfter)) throw new security.AuthFailure("Sign in.", 401);
        return { user_id: owner };
      },
    },
    "./objects": objects, "./r2": { createR2Store() { throw new Error("Injected object store required"); } },
    "./verify": { async verifyImage(...args) { events.push("verifyImage"); return verification.verifyImage(...args); } },
  });
  const clients = { client: options.adminAsUser ? admin : client, admin };
  const service = serviceModule.createPrivateStorageService(clients, () => { objectStoreCalls++; return store; });
  return { service, clients, calls, events, row, sessionChecks: () => sessionChecks, objectStoreCalls: () => objectStoreCalls };
}

for (const action of ["reserveUpload", "completeUpload", "download", "remove", "requireReadyInputs"]) {
  test(`${action}: anonymous session denied before storage or database query`, async () => {
    const s = scenario({ session: false });
    const value = action === "reserveUpload" ? { filename: "image.png", content_type: "image/png", byte_size: 100 }
      : action === "requireReadyInputs" ? [objectId] : objectId;
    await assert.rejects(s.service[action](project, value), { status: 401 });
    assert.equal(s.calls.length, 0);
    assert.equal(s.objectStoreCalls(), 0);
  });
  test(`${action}: foreign parent denied before reading object or signing`, async () => {
    const s = scenario({ parent: false });
    const value = action === "reserveUpload" ? { filename: "image.png", content_type: "image/png", byte_size: 100 }
      : action === "requireReadyInputs" ? [objectId] : objectId;
    await assert.rejects(s.service[action](project, value), { status: 404 });
    assert.equal(s.calls.length, 1);
    assert.equal(s.objectStoreCalls(), 0);
  });
}

test("admin client never enters user ownership authorization", async () => {
  const s = scenario({ adminAsUser: true });
  await assert.rejects(s.service.download(project, objectId), { status: 503 });
  assert.equal(s.sessionChecks(), 0);
  assert.equal(s.calls.length, 0);
  assert.equal(s.objectStoreCalls(), 0);
});

test("empty generation input list still requires authenticated project ownership", async () => {
  const anonymous = scenario({ session: false });
  await assert.rejects(anonymous.service.requireReadyInputs(project, []), { status: 401 });
  assert.equal(anonymous.calls.length, 0);
  const foreignProject = scenario({ parent: false });
  await assert.rejects(foreignProject.service.requireReadyInputs(project, []), { status: 404 });
  assert.equal(foreignProject.objectStoreCalls(), 0);
});

test("owned project with inaccessible object returns 404 before storage or signing", async () => {
  for (const action of ["completeUpload", "download", "remove", "requireReadyInputs"]) {
    const s = scenario({ found: false });
    await assert.rejects(s.service[action](project, action === "requireReadyInputs" ? [objectId] : objectId), { status: 404 });
    assert.equal(s.objectStoreCalls(), 0);
    assert.equal(s.events.some((event) => ["uploadUrl", "downloadUrl", "seal"].includes(event)), false);
  }
});

test("reservation signs only validated persisted keys after fresh ownership check", async () => {
  const s = scenario();
  const result = await s.service.reserveUpload(project, { filename: "image.png", content_type: "image/png", byte_size: 100 });
  assert.equal(result.objectId, objectId);
  assert.equal(result.method, "PUT");
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.ok(result.expiresIn > 0 && result.expiresIn <= 120);
  const reserve = s.calls.find((call) => call.name === "reserve_project_upload");
  assert.equal(reserve.parameters.p_project_id, project);
  assert.equal(Object.hasOwn(reserve.parameters, "p_owner_id"), false);
  assert.equal(Object.hasOwn(reserve.parameters, "p_object_key"), false);
  assert.equal(s.sessionChecks(), 2);
  for (const query of s.calls.filter((call) => call.table)) assert.ok(query.filters.some(([field, value]) => field === "owner_id" && value === owner));
});

test("forged request keys, durable quota errors, and malformed stored keys cannot produce links", async () => {
  const injected = scenario();
  await assert.rejects(injected.service.reserveUpload(project, { filename: "image.png", content_type: "image/png", byte_size: 100, object_key: "../other" }), { status: 400 });
  assert.equal(injected.objectStoreCalls(), 0);
  const limited = scenario({ reserveError: { code: "53100" } });
  await assert.rejects(limited.service.reserveUpload(project, { filename: "image.png", content_type: "image/png", byte_size: 100 }), { status: 413 });
  assert.equal(limited.events.includes("uploadUrl"), false);
  for (const row of [{ object_key: "another-account/key" }, { staging_key: "../key" }, { owner_id: otherOwner }]) {
    const s = scenario({ row });
    await assert.rejects(s.service.download(project, objectId));
    assert.equal(s.objectStoreCalls(), 0);
  }
});

test("pending and rejected objects cannot download or enter generation", async () => {
  for (const status of ["pending", "rejected"]) {
    const s = scenario({ row: { status } });
    await assert.rejects(s.service.download(project, objectId), { status: 409 });
    await assert.rejects(s.service.requireReadyInputs(project, [objectId]), { status: 409 });
    assert.equal(s.objectStoreCalls(), 0);
  }
});

test("expired upload and retention deadlines cannot complete, download, or enter generation", async () => {
  const expired = new Date(Date.now() - 1000).toISOString();
  const pending = scenario({ row: { upload_expires_at: expired } });
  await assert.rejects(pending.service.completeUpload(project, objectId), { status: 410 });
  assert.equal(pending.objectStoreCalls(), 0);
  const ready = scenario({ row: { status: "ready", etag: "verified", retention_expires_at: expired } });
  await assert.rejects(ready.service.download(project, objectId), { status: 410 });
  await assert.rejects(ready.service.requireReadyInputs(project, [objectId]), { status: 410 });
  assert.equal(ready.objectStoreCalls(), 0);
});

test("completion decodes actual bytes before immutable seal and worker finalization", async () => {
  const png = await image;
  const s = scenario({ bytes: png, row: { byte_size: png.length } });
  const result = await s.service.completeUpload(project, objectId);
  assert.equal(result.status, "ready");
  assert.ok(s.events.indexOf("readStaging") < s.events.indexOf("verifyImage"));
  assert.ok(s.events.indexOf("verifyImage") < s.events.indexOf("seal"));
  assert.ok(s.events.indexOf("seal") < s.events.indexOf("storage_complete_object"));
  const finalization = s.calls.find((call) => call.name === "storage_complete_object");
  assert.equal(finalization.role, "admin");
  assert.equal(finalization.parameters.p_owner_id, owner);
  assert.equal(finalization.parameters.p_project_id, project);
  assert.equal(finalization.parameters.p_byte_size, png.length);
  assert.equal(s.sessionChecks(), 3);
});

test("invalid completion schedules deletion and never seals or marks ready", async () => {
  const bytes = Buffer.from("not an image");
  const s = scenario({ bytes, row: { byte_size: bytes.length } });
  await assert.rejects(s.service.completeUpload(project, objectId), { status: 400 });
  assert.equal(s.events.includes("delete_project_object"), true);
  assert.equal(s.events.includes("seal"), false);
  assert.equal(s.events.includes("storage_complete_object"), false);
});

test("session revoked during completion cannot seal or finalize verified object", async () => {
  const png = await image;
  const s = scenario({ bytes: png, row: { byte_size: png.length }, revokeAfter: 1 });
  await assert.rejects(s.service.completeUpload(project, objectId), { status: 401 });
  assert.equal(s.events.includes("verifyImage"), true);
  assert.equal(s.events.includes("seal"), false);
  assert.equal(s.events.includes("storage_complete_object"), false);
});

test("verified output downloads and ready upload IDs enforce retention and input limits", async () => {
  const output = scenario({ row: { status: "ready", kind: "output", etag: "verified" } });
  const download = await output.service.download(project, objectId);
  assert.equal(download.url, "signed-download");
  assert.ok(download.expiresIn > 0 && download.expiresIn <= 60);
  await assert.rejects(output.service.requireReadyInputs(project, [objectId]), { status: 409 });
  const upload = scenario({ row: { status: "ready", etag: "verified" } });
  assert.equal((await upload.service.requireReadyInputs(project, [objectId]))[0].id, objectId);
  for (const ids of [[objectId, objectId], Array(9).fill(objectId), "https://arbitrary.example/image.png"]) {
    await assert.rejects(upload.service.requireReadyInputs(project, ids), { status: 400 });
  }
});

test("real AWS SDK presigner binds fixed staging key, headers, method parameters, and expiration", async () => {
  const sdk = require("@aws-sdk/client-s3");
  const api = load("storage/r2.ts", {
    "server-only": {}, "@/lib/auth/security": security,
    "@aws-sdk/client-s3": sdk, "@aws-sdk/s3-request-presigner": require("@aws-sdk/s3-request-presigner"),
    "node:crypto": require("node:crypto"),
    "./objects": objects,
    "./config": { ...config, storageConfig: () => ({
      bucket: "unit-private-bucket", endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
      accessKeyId: "unit-test-access-key", secretAccessKey: "unit-test-secret-never-used-on-network",
    }) },
  });
  const store = api.createR2Store();
  const row = storedRow();
  // Inspect locally; never log signed bearer URLs or contact R2 in this test.
  const upload = new URL(await store.uploadUrl(row, 120));
  assert.equal(upload.pathname, `/unit-private-bucket/${row.staging_key}`);
  assert.equal(upload.searchParams.get("X-Amz-Expires"), "120");
  const headers = upload.searchParams.get("X-Amz-SignedHeaders").split(";");
  for (const header of ["content-type", "content-length", "cache-control", "host"]) assert.ok(headers.includes(header));
  const download = new URL(await store.downloadUrl({ ...row, status: "ready", etag: "verified" }, 60));
  assert.equal(download.pathname, `/unit-private-bucket/${row.object_key}`);
  assert.equal(download.searchParams.get("X-Amz-Expires"), "60");
  assert.equal(download.searchParams.get("response-cache-control"), "private, no-store");
  assert.equal(download.searchParams.get("response-content-disposition"), "attachment");
  assert.equal(download.searchParams.get("response-content-type"), "image/png");
});

function r2Scenario(send) {
  const sdk = require("@aws-sdk/client-s3");
  const calls = [];
  const api = load("storage/r2.ts", {
    "server-only": {}, "@/lib/auth/security": security, "./objects": objects,
    "@aws-sdk/client-s3": { ...sdk, S3Client: class {
      async send(command, options) { calls.push({ command, options }); return send(command, calls.length); }
    } },
    "@aws-sdk/s3-request-presigner": {}, "node:crypto": require("node:crypto"),
    "./config": { ...config, storageConfig: () => ({
      bucket: "unit-private-bucket", endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
      accessKeyId: "unit-test-access-key", secretAccessKey: "unit-test-secret-never-used-on-network",
    }) },
  });
  return { store: api.createR2Store(), calls };
}

function r2Body(chunks) {
  let cancelled = false;
  return {
    body: { transformToWebStream: () => new ReadableStream({
      start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
      cancel() { cancelled = true; },
    }) },
    cancelled: () => cancelled,
  };
}

test("R2 staging read binds GET to checked HEAD ETag before bounded streaming", async () => {
  const row = storedRow({ byte_size: 3 });
  const stream = r2Body([Buffer.from("png")]);
  const s = r2Scenario(async (_command, count) => count === 1
    ? { ContentLength: 3, ContentType: "image/png", ETag: "head-etag" }
    : { ContentLength: 3, ContentType: "image/png", Body: stream.body });
  assert.equal((await s.store.readStaging(row)).toString(), "png");
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].command.constructor.name, "HeadObjectCommand");
  assert.equal(s.calls[1].command.constructor.name, "GetObjectCommand");
  assert.equal(s.calls[1].command.input.IfMatch, "head-etag");
  assert.equal(s.calls[1].command.input.Key, row.staging_key);
  assert.equal(s.calls[1].command.input.Bucket, "unit-private-bucket");
});

test("R2 HEAD mismatched length, type, or missing ETag prevents GET", async () => {
  for (const patch of [{ ContentLength: 4 }, { ContentType: "text/html" }, { ETag: undefined }]) {
    const s = r2Scenario(async () => ({ ContentLength: 3, ContentType: "image/png", ETag: "head-etag", ...patch }));
    await assert.rejects(s.store.readStaging(storedRow({ byte_size: 3 })), { status: 400 });
    assert.equal(s.calls.length, 1);
  }
});

test("R2 oversized, truncated, and mismatched GET responses cannot reach verification", async () => {
  for (const [chunks, responsePatch, status] of [
    [[Buffer.from("long")], {}, 413], [[Buffer.from("pn")], {}, 400],
    [[Buffer.from("png")], { ContentType: "text/html" }, 400],
  ]) {
    const stream = r2Body(chunks);
    const s = r2Scenario(async (_command, count) => count === 1
      ? { ContentLength: 3, ContentType: "image/png", ETag: "head-etag" }
      : { ContentLength: 3, ContentType: "image/png", Body: stream.body, ...responsePatch });
    await assert.rejects(s.store.readStaging(storedRow({ byte_size: 3 })), { status });
    assert.equal(s.calls.length, 2);
  }
});

test("R2 sealing creates immutable final key with verified-byte hash and private response metadata", async () => {
  const row = storedRow({ byte_size: 3 });
  const bytes = Buffer.from("png");
  const digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const s = r2Scenario(async () => ({ ETag: "sealed-etag" }));
  assert.equal(await s.store.seal(row, bytes), "sealed-etag");
  assert.equal(s.calls.length, 1);
  const input = s.calls[0].command.input;
  assert.equal(input.Key, row.object_key);
  assert.equal(input.IfNoneMatch, "*");
  assert.equal(input.Metadata.sha256, digest);
  assert.equal(input.ContentLength, 3);
  assert.equal(input.ContentType, "image/png");
  assert.equal(input.ContentDisposition, "attachment");
  assert.equal(input.CacheControl, "private, no-store");
});

test("R2 seal retries recover only exact already-verified bytes without replacement", async () => {
  const bytes = Buffer.from("png");
  const digest = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
  const s = r2Scenario(async (_command, count) => {
    if (count === 1) throw new Error("Simulated write timeout after stored object");
    return { Metadata: { sha256: digest }, ContentLength: 3, ContentType: "image/png", ETag: "persisted-etag" };
  });
  assert.equal(await s.store.seal(storedRow({ byte_size: 3 }), bytes), "persisted-etag");
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].command.input.IfNoneMatch, "*");
  assert.equal(s.calls[1].command.constructor.name, "HeadObjectCommand");
  assert.equal(s.calls[1].command.input.Key, storedRow().object_key);
  for (const patch of [
    { Metadata: { sha256: "different-content" } }, { ContentLength: 4 }, { ContentType: "text/html" }, { ETag: undefined },
  ]) {
    const conflict = r2Scenario(async (_command, count) => {
      if (count === 1) throw new Error("Simulated precondition failure");
      return { Metadata: { sha256: digest }, ContentLength: 3, ContentType: "image/png", ETag: "persisted-etag", ...patch };
    });
    await assert.rejects(conflict.store.seal(storedRow({ byte_size: 3 }), bytes), { status: 409 });
    assert.equal(conflict.calls.length, 2);
  }
});

test("R2 seal refuses expired reservation before writing final object", async () => {
  const s = r2Scenario(async () => ({ ETag: "unexpected" }));
  await assert.rejects(s.store.seal(storedRow({ upload_expires_at: new Date(Date.now() - 1000).toISOString() }), Buffer.from("png")), { status: 410 });
  assert.equal(s.calls.length, 0);
});

test("storage configuration rejects disabled storage and injected account or bucket configuration", () => {
  const baseline = {
    PRIVATE_STORAGE_ENABLED: "true", R2_ACCOUNT_ID: "a".repeat(32), R2_PRIVATE_BUCKET: "unit-private-bucket",
    R2_ACCESS_KEY_ID: "unit-test-access-key", R2_SECRET_ACCESS_KEY: "unit-test-secret-never-used-on-network",
  };
  for (const patch of [
    { PRIVATE_STORAGE_ENABLED: "false" }, { R2_ACCOUNT_ID: "attacker.example" },
    { R2_PRIVATE_BUCKET: "../another-bucket" }, { R2_ACCESS_KEY_ID: "" }, { R2_SECRET_ACCESS_KEY: "" },
  ]) {
    const api = load("storage/config.ts", { "server-only": {}, "@/lib/auth/security": security }, { process: { env: { ...baseline, ...patch } } });
    assert.throws(() => api.storageConfig(), { status: 503 });
  }
});

function handlerScenario(options = {}) {
  const calls = [];
  const handlers = load("storage/handlers.ts", {
    "server-only": {}, "@/lib/auth/security": security,
    "@/lib/auth/server": { authClients: async () => ({ config: { origin }, client: {}, admin: {} }) },
    "@/lib/security/edge-origin": { requireEdgeOrigin() { if (options.badEdge) throw new security.AuthFailure("Origin rejected.", 403); } },
    "@/lib/auth/handlers": {
      authJson: (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } }),
      authError: (error) => Response.json({ error: error instanceof security.AuthFailure ? error.message : "Unavailable" }, {
        status: error.status ?? 503, headers: { "cache-control": "private, no-store" },
      }),
    },
    "./service": { createPrivateStorageService: () => ({
      reserveUpload: async (...args) => { calls.push(["upload", ...args]); return { objectId, url: "signed-upload" }; },
      download: async (...args) => { calls.push(["download", ...args]); return { objectId, url: "signed-download" }; },
      completeUpload: async (...args) => { calls.push(["complete", ...args]); return { objectId, status: "ready" }; },
      remove: async (...args) => { calls.push(["delete", ...args]); },
    }) },
  });
  const request = (body = {}, headers = {}) => new Request(`${origin}/api/projects/${project}/objects/${objectId}/download`, {
    method: "POST", headers: { origin, "content-type": "application/json", "x-requested-with": "flashloop", ...headers },
    body: JSON.stringify(body),
  });
  return { ...handlers, calls, request };
}

test("signing handlers require same-origin JSON CSRF proof even for downloads", async () => {
  for (const headers of [
    { origin: "https://attacker.example" }, { "x-requested-with": "" },
    { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" },
  ]) {
    const s = handlerScenario();
    const response = await s.handleStorageRequest(s.request({}, headers), { projectId: project, objectId }, "download");
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(s.calls.length, 0);
  }
});

test("all successful storage handler responses and failures are private no-store", async () => {
  for (const [action, status] of [["upload", 201], ["download", 200], ["complete", 200], ["delete", 202]]) {
    const s = handlerScenario();
    const response = await s.handleStorageRequest(s.request(), { projectId: project, objectId }, action);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(s.calls.length, 1);
  }
  const s = handlerScenario();
  const response = await s.handleStorageRequest(s.request({ object_key: "another-owner/key" }), { projectId: project, objectId }, "download");
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(s.calls.length, 0);
});

test("edge-origin rejection blocks every storage handler before signing", async () => {
  const s = handlerScenario({ badEdge: true });
  const response = await s.handleStorageRequest(s.request(), { projectId: project, objectId }, "download");
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(s.calls.length, 0);
});
