const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const { spawnSync } = require("node:child_process");

const id = "2be2b9d7-397d-4b5f-ab9b-4158915de234";
const jobId = "eb57b2a8-98e6-47b2-a378-ec6c3723defe";
const config = { environment: "staging", release: "abcdef1234567", dsn: "https://00000000000000000000000000000000@o1.ingest.de.sentry.io/1", tracesSampleRate: 1 };
const validEnv = { SENTRY_ENABLED: "true", SENTRY_PRIVACY_APPROVED: "true", TELEMETRY_ENVIRONMENT: "staging", SENTRY_RELEASE: config.release, SENTRY_STAGING_DSN: config.dsn };

function loader(env = {}, sdk = {}) {
  const cache = new Map();
  const load = (name) => {
    if (cache.has(name)) return cache.get(name);
    const source = readFileSync(resolve(__dirname, "../src/lib/observability", name + ".ts"), "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    cache.set(name, module.exports);
    vm.runInNewContext(code, {
      exports: module.exports, module, process: { env }, URL,
      require(path) {
        if (path === "server-only") return {};
        if (path === "@sentry/node") return sdk;
        if (path === "node:crypto") return require(path);
        if (path.startsWith("./")) return load(path.slice(2));
        throw new Error("Unexpected dependency.");
      },
    });
    return module.exports;
  };
  return load;
}

test("Sentry stays disabled until explicit environment, privacy and release setup exists", () => {
  const { sentryConfig } = loader() ("sentry-config");
  assert.equal(sentryConfig(), null);
  assert.equal(sentryConfig({ ...validEnv, SENTRY_PRIVACY_APPROVED: undefined }), null);
  assert.equal(sentryConfig({ ...validEnv, TELEMETRY_ENVIRONMENT: "preview" }), null);
  assert.equal(sentryConfig({ ...validEnv, TELEMETRY_ENVIRONMENT: "production" }), null);
  assert.equal(sentryConfig({ ...validEnv, SENTRY_RELEASE: "private-user@example.com" }), null);
  assert.equal(sentryConfig({ ...validEnv, SENTRY_TRACES_SAMPLE_RATE: "1.5" }), null);
  assert.equal(sentryConfig({ ...validEnv, STATIC_EXPORT: "true" }), null);
  assert.equal(sentryConfig({ ...validEnv, SENTRY_PRODUCTION_DSN: config.dsn }), null);
  assert.equal(sentryConfig({ ...validEnv, SENTRY_PRODUCTION_DSN: config.dsn.replace("00000000000000000000000000000000", "11111111111111111111111111111111") }), null);
  for (const dsn of ["http://localhost/1", config.dsn + "?secret=private", config.dsn.replace("ingest.de.sentry.io", "example.com"), config.dsn.replace("@", ":secret@")]) {
    assert.equal(sentryConfig({ ...validEnv, SENTRY_STAGING_DSN: dsn }), null);
  }
  assert.equal(sentryConfig(validEnv).dsn, config.dsn);
  const productionDsn = config.dsn.replace("/1", "/2");
  const production = sentryConfig({ ...validEnv, TELEMETRY_ENVIRONMENT: "production", SENTRY_PRODUCTION_DSN: productionDsn });
  assert.equal(production.dsn, productionDsn);
  assert.equal(production.tracesSampleRate, 0.1);
});

test("correlation accepts UUID fields only and generates fresh server IDs", () => {
  const { newRequestId, safeCorrelation } = loader()("correlation");
  const a = newRequestId();
  const b = newRequestId();
  assert.notEqual(a, b);
  assert.match(a, /^[a-f0-9-]{36}$/);
  assert.equal(JSON.stringify(safeCorrelation({ requestId: id, jobId: "private-user@example.com", signedUrl: "private" })), JSON.stringify({ requestId: id }));
  for (const value of [null, [], false, "private"]) assert.equal(JSON.stringify(safeCorrelation(value)), "{}");
});

test("event boundary rebuilds errors and removes all ambient sensitive data", () => {
  const { safeSentryEvent } = loader()("sentry-privacy");
  const privateValue = "private-personal-prompt-cookie-signed-url";
  const event = {
    type: undefined, event_id: "1".repeat(32), timestamp: 123,
    tags: { operation: "generation", requestId: id, jobId, prompt: privateValue },
    message: privateValue, logentry: { message: privateValue }, user: { email: privateValue, ip_address: privateValue },
    request: { url: privateValue, headers: { Authorization: privateValue, cookie: privateValue }, data: privateValue },
    exception: { values: [{ type: privateValue, value: privateValue, stacktrace: { frames: [{ vars: { secret: privateValue } }] } }] },
    contexts: { custom: { privateValue }, trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), data: { privateValue }, description: privateValue } },
    breadcrumbs: [{ message: privateValue }], extra: { privateValue }, attachments: [{ filename: privateValue }],
    server_name: privateValue, sdkProcessingMetadata: { privateValue }, modules: { privateValue },
  };
  const result = safeSentryEvent(event, config);
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes(privateValue), false);
  assert.equal(result.tags.requestId, id);
  assert.equal(result.tags.jobId, jobId);
  assert.equal(result.contexts.trace.trace_id, "a".repeat(32));
  assert.equal(result.exception.values[0].value, "generation failed.");
  assert.equal(safeSentryEvent({ tags: { operation: privateValue } }, config), null);
});

test("streamed spans drop URLs, payloads, users, arbitrary attributes and links", () => {
  const { safeSentrySpan } = loader()("sentry-privacy");
  const privateValue = "private-media-signed-url";
  const span = { name: "generation_job", trace_id: "a".repeat(32), span_id: "b".repeat(16), parent_span_id: "c".repeat(16),
    start_timestamp: 10, end_timestamp: 11, status: "error", is_segment: true,
    attributes: { requestId: id, jobId, "user.email": privateValue, "http.url": privateValue, "gen_ai.input.messages": privateValue },
    links: [{ attributes: { privateValue } }], privateValue,
  };
  const result = safeSentrySpan(span, config);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
  assert.equal(result.attributes.requestId, id);
  assert.equal(result.attributes.jobId, jobId);
  assert.equal(result.links, undefined);
});

function sdkFixture({ spanFails = false, beforeFails = false } = {}) {
  const events = [];
  const spans = [];
  let options;
  const sdk = {
    init(value) { options = value; },
    spanStreamingIntegration() { return { name: "SpanStreaming" }; },
    captureEvent(event) { events.push(event); return "a".repeat(32); },
    withIsolationScope(callback) { if (beforeFails) throw new Error("SDK unavailable"); return callback(); },
    startNewTrace(callback) { return callback(); },
    startSpan(span, callback) {
      spans.push(span);
      return callback({ setAttributes(attributes) { span.attributes = attributes; if (spanFails) throw new Error("SDK unavailable"); } });
    },
    flush: async () => true,
  };
  const load = loader({ ...validEnv }, sdk);
  return { load, api: load("sentry"), events, spans, options: () => options };
}

test("manual SDK options disable automatic capture and cover every outgoing telemetry hook", async () => {
  const s = sdkFixture();
  assert.equal(s.api.initializeSentry(), true);
  const options = s.options();
  assert.equal(options.defaultIntegrations, false);
  assert.equal(options.integrations.length, 1);
  assert.equal(options.integrations[0].name, "SpanStreaming");
  assert.equal(options.enableRuntimeChannelInjection, false);
  assert.equal(options.enableOpenTelemetrySetup, false);
  assert.equal(options.spotlight, false);
  assert.equal(options.maxBreadcrumbs, 0);
  assert.equal(JSON.stringify(options.tracePropagationTargets), "[]");
  assert.equal(JSON.stringify(options.dataCollection.httpBodies), "[]");
  assert.equal(options.dataCollection.userInfo, false);
  assert.equal(options.beforeSendLog({ body: "private" }), null);
  assert.equal(options.beforeSendMetric({ name: "private" }), null);
  const hint = { attachments: [{ data: "private" }] };
  options.beforeSend({ tags: { operation: "framework" } }, hint);
  assert.equal(hint.attachments.length, 0);
  const correlation = { requestId: id };
  const result = await s.api.traceOperation("generation", correlation, async () => { correlation.jobId = jobId; return "ok"; });
  assert.equal(result, "ok");
  assert.equal(s.spans[0].attributes.jobId, jobId);
});

test("SDK failures never repeat work, replace application result or expose thrown content", async () => {
  for (const options of [{ beforeFails: true }, { spanFails: true }]) {
    const s = sdkFixture(options);
    let calls = 0;
    assert.equal(await s.api.traceOperation("authorization", { requestId: id }, async () => { calls++; return "ok"; }), "ok");
    assert.equal(calls, 1);
  }
  const s = sdkFixture({ spanFails: true });
  const privateError = new Error("private credentials prompt signed URL");
  await assert.rejects(s.api.traceOperation("generation_job", { requestId: id, jobId }, async () => { throw privateError; }), (error) => error === privateError);
  assert.equal(s.events.length, 1);
  assert.equal(JSON.stringify(s.events).includes(privateError.message), false);
  assert.equal(s.events[0].tags.jobId, jobId);
});

test("installed Sentry SDK emits scrubbed error and streamed span through local transport", async () => {
  const Sentry = require("@sentry/node");
  const s = sdkFixture();
  s.api.initializeSentry();
  const envelopes = [];
  Sentry.init({ ...s.options(), integrations: [Sentry.spanStreamingIntegration()],
    transport: () => ({ send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true }),
  });
  const privateValue = "PRIVATE_SENTINEL_CREDENTIAL_MEDIA_COOKIE_SIGNED_URL";
  try {
    await Sentry.withIsolationScope(async (scope) => {
      scope.setUser({ email: privateValue, ip_address: privateValue });
      scope.setExtra("media", privateValue);
      scope.addAttachment({ filename: "private.txt", data: privateValue });
      await Sentry.startNewTrace(() => Sentry.startSpan({ name: "staging_probe", attributes: { requestId: id, jobId, prompt: privateValue } }, async () => {
        Sentry.captureEvent({ message: privateValue, exception: { values: [{ value: privateValue }] },
          tags: { operation: "staging_probe", requestId: id, jobId, secret: privateValue },
          request: { url: "https://private.example/?secret=" + privateValue, cookies: { auth: privateValue } },
        });
      }));
    });
    assert.equal(await Sentry.flush(2000), true);
    const encoded = JSON.stringify(envelopes);
    assert.ok(envelopes.some((envelope) => envelope[1].some(([header]) => header.type === "event")));
    assert.ok(envelopes.some((envelope) => envelope[1].some(([header]) => header.type === "span")));
    assert.equal(encoded.includes(privateValue), false);
    assert.ok(encoded.includes(id));
    assert.ok(encoded.includes(jobId));
  } finally { await Sentry.close(2000); }
});

test("staging probe rejects missing setup and production without logging configuration", () => {
  const privateValue = "PRIVATE_PROBE_CONFIGURATION";
  for (const env of [
    { SENTRY_STAGING_PROBE: "true", SENTRY_STAGING_DSN: privateValue },
    { ...validEnv, TELEMETRY_ENVIRONMENT: "production", SENTRY_PRODUCTION_DSN: config.dsn.replace("/1", "/2"), SENTRY_STAGING_PROBE: "true", PRIVATE_SETUP: privateValue },
  ]) {
    const result = spawnSync(process.execPath, [resolve(__dirname, "../scripts/verify-sentry-staging.cjs")], {
      encoding: "utf8", env: { PATH: process.env.PATH, ...env },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Sentry staging probe incomplete/);
    assert.equal((result.stdout + result.stderr).includes(privateValue), false);
    assert.equal((result.stdout + result.stderr).includes(config.dsn), false);
  }
});
