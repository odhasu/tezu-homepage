const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");

const root = resolve(__dirname, "../src");
const policyVersion = "staging.2026-11-v1";
const environment = {
  TELEMETRY_ENVIRONMENT: "staging", POSTHOG_STAGING_ENABLED: "true",
  POSTHOG_STAGING_PROJECT_TOKEN: "phc_synthetic_test_token", POSTHOG_STAGING_HOST: "https://eu.i.posthog.com",
  ANALYTICS_CONSENT_POLICY_VERSION: "2026-11-v1", ANALYTICS_CONSENT_POLICY_APPROVED: "true",
  AUTH_ORIGIN: "https://flashloop-staging.example.com",
};
const requestId = "59cf3717-85da-4cdd-96c6-d47ec98c9574";
const jobId = "8cc71466-0ab7-4320-94fc-94c29af8c42c";
const properties = { requestId, httpStatus: 202, operation: "generation", jobId };

function fixture(extra = {}, fetcher, browserGlobals = {}) {
  const calls = [];
  const afterCallbacks = [];
  const env = { ...environment, ...extra };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    cache.set(path, module.exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports, require(name) {
        if (name === "server-only") return {};
        if (name === "next/server") return { after: (callback) => afterCallbacks.push(callback) };
        if (name === "node:crypto") return crypto;
        if (name === "node:net") return require("node:net");
        if (name.startsWith("@/")) return load(resolve(root, name.slice(2) + ".ts"));
        if (name.startsWith(".")) return load(resolve(path, "..", name + ".ts"));
        throw new Error(`Unexpected import ${name}`);
      },
      process: { env }, URL, Request, Response, Headers, AbortSignal, TextDecoder,
      TextEncoder, Date, Uint8Array, Error,
      fetch: async (url, options) => {
        calls.push({ url, options, body: JSON.parse(options.body) });
        if (fetcher) return fetcher(url, options);
        return new Response(null, { status: 200 });
      },
      ...browserGlobals,
    });
    cache.set(path, module.exports);
    return module.exports;
  }
  return { env, calls, load, drainAfter: async () => Promise.all(afterCallbacks.splice(0).map((callback) => callback())),
    consent: load(resolve(root, "lib/analytics/consent.ts")),
    server: load(resolve(root, "lib/analytics/server.ts")), handlers: load(resolve(root, "lib/analytics/handlers.ts")) };
}

function request(f, headers = {}, body = { page: "home" }) {
  return new Request(environment.AUTH_ORIGIN + "/api/analytics?code=private-auth-code", {
    method: "POST", body: JSON.stringify(body), headers: {
      origin: environment.AUTH_ORIGIN, "content-type": "application/json", "x-requested-with": "flashloop",
      cookie: f.consent.analyticsConsentCookie("granted", policyVersion, true).split(";")[0],
      authorization: "Bearer synthetic-private-token", referer: "https://example.com/private?signature=synthetic",
      "x-forwarded-for": "192.0.2.10", ...headers,
    },
  });
}

test("Capture API body is allowlisted despite credential, cookie, content and signed URL inputs", async () => {
  const f = fixture();
  await f.server.captureAnalytics(request(f), "generation", { ...properties,
    generationRequestId: requestId, password: "synthetic-password", email: "personal@example.com",
    media: "https://private.example.com/media?signature=synthetic", prompt: "personal prompt", url: "https://private.example.com",
  });
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.url, "https://eu.i.posthog.com/i/v0/e");
  assert.equal(call.options.cache, "no-store");
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.credentials, "omit");
  assert.deepEqual(Object.keys(call.options.headers), ["Content-Type"]);
  assert.deepEqual(JSON.parse(JSON.stringify(call.body)), {
    api_key: environment.POSTHOG_STAGING_PROJECT_TOKEN, distinct_id: requestId, event: "flashloop_generation",
    properties: { request_id: requestId, http_status: 202, operation: "generation", job_id: jobId,
      generation_request_id: requestId, environment: "staging", $process_person_profile: false, $geoip_disable: true },
  });
  const serialized = JSON.stringify(call.body);
  for (const needle of ["synthetic-password", "personal@example", "private.example", "personal prompt", "private-auth-code", "private-token", "192.0.2.10", "flashloop_analytics_consent"]) {
    assert.equal(serialized.includes(needle), false);
  }
});

for (const [name, headers] of [
  ["absent", { cookie: "" }], ["rejected", { cookie: `flashloop_analytics_consent=${policyVersion}:denied:${Math.floor(Date.now() / 1000)}` }],
  ["GPC", { "sec-gpc": "1" }], ["DNT", { dnt: "1" }],
  ["old policy", { cookie: `flashloop_analytics_consent=staging.old:granted:${Math.floor(Date.now() / 1000)}` }],
  ["production policy", { cookie: `flashloop_analytics_consent=production.2026-11-v1:granted:${Math.floor(Date.now() / 1000)}` }],
]) test(`${name} consent prevents every intended event`, async () => {
  const f = fixture();
  for (const event of ["signup", "verification", "authorization", "generation", "quota_rejection", "webhook"]) {
    await f.server.captureAnalytics(request(f, headers), event, properties);
  }
  assert.equal(f.calls.length, 0);
});

test("consent expiry, future time and ambiguous duplicate cookies fail closed", () => {
  const f = fixture();
  const now = 1793892000000;
  const allowed = f.consent.analyticsConsentCookie("granted", policyVersion, true, now).split(";")[0];
  assert.equal(f.consent.readAnalyticsConsent(allowed, policyVersion, now), "granted");
  assert.equal(f.consent.readAnalyticsConsent(allowed, policyVersion, now + 30 * 86400 * 1000), null);
  assert.equal(f.consent.readAnalyticsConsent(allowed, policyVersion, now - 1000), null);
  assert.equal(f.consent.readAnalyticsConsent(`${allowed}; ${allowed}`, policyVersion, now), null);
});

test("revocation applies before next event and does not reuse a browser identifier", async () => {
  const f = fixture();
  await f.server.captureAnalytics(request(f), "signup", { ...properties, operation: "signup" });
  const denied = f.consent.analyticsConsentCookie("denied", policyVersion, true).split(";")[0];
  await f.server.captureAnalytics(request(f, { cookie: denied }), "verification", properties);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.distinct_id, requestId);
  assert.equal(f.consent.browserPrivacyEnabled({ globalPrivacyControl: true }), true);
  assert.equal(f.consent.browserPrivacyEnabled({ doNotTrack: "1" }), true);
});

for (const [name, config] of [
  ["disabled", { POSTHOG_STAGING_ENABLED: "false" }], ["unapproved policy", { ANALYTICS_CONSENT_POLICY_APPROVED: "false" }],
  ["missing region", { POSTHOG_STAGING_HOST: "" }], ["unknown destination", { POSTHOG_STAGING_HOST: "https://example.com" }],
  ["destination query", { POSTHOG_STAGING_HOST: "https://eu.i.posthog.com?token=synthetic" }],
  ["unknown environment", { TELEMETRY_ENVIRONMENT: "preview" }], ["static export", { STATIC_EXPORT: "true" }],
  ["same project tokens", { POSTHOG_PRODUCTION_PROJECT_TOKEN: environment.POSTHOG_STAGING_PROJECT_TOKEN }],
]) test(`${name} configuration sends nothing and exposes no client settings`, async () => {
  const f = fixture(config);
  await f.server.captureAnalytics(request(f), "generation", properties);
  assert.equal(f.calls.length, 0);
  assert.equal(f.server.analyticsClientConfig(), null);
});

test("production never falls back to staging configuration", async () => {
  const f = fixture({ TELEMETRY_ENVIRONMENT: "production" });
  await f.server.captureAnalytics(request(f), "generation", properties);
  assert.equal(f.calls.length, 0);
  f.env.POSTHOG_PRODUCTION_ENABLED = "true";
  f.env.POSTHOG_PRODUCTION_HOST = "https://us.i.posthog.com";
  f.env.POSTHOG_PRODUCTION_PROJECT_TOKEN = "phc_other_synthetic_test_token";
  const cookie = f.consent.analyticsConsentCookie("granted", "production.2026-11-v1", true).split(";")[0];
  await f.server.captureAnalytics(request(f, { cookie }), "generation", properties);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://us.i.posthog.com/i/v0/e");
  assert.equal(f.calls[0].body.api_key, f.env.POSTHOG_PRODUCTION_PROJECT_TOKEN);
  assert.equal(f.calls[0].body.properties.environment, "production");
});

test("invalid correlation and arbitrary event names cannot reach transport", async () => {
  const f = fixture();
  await f.server.captureAnalytics(request(f), "generation", { ...properties, requestId: "email@example.com" });
  await f.server.captureAnalytics(request(f), "generation", { ...properties, operation: "private prompt" });
  await f.server.captureAnalytics(request(f), "personal text", properties);
  await f.server.capturePageview(request(f), "private path?token=synthetic");
  assert.equal(f.calls.length, 0);
});

test("pageview endpoint accepts only fixed page enum with newly generated request ID", async () => {
  const f = fixture();
  const response = await f.handlers.handleAnalyticsPageview(request(f));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  assert.equal(f.calls.length, 0);
  await f.drainAfter();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].body.event, "flashloop_pageview");
  assert.equal(f.calls[0].body.properties.page, "home");
  assert.match(f.calls[0].body.properties.request_id, /^[0-9a-f-]{36}$/);
  assert.equal((await f.handlers.handleAnalyticsPageview(request(f, {}, { page: "home", media: "private" }))).status, 400);
  assert.equal((await f.handlers.handleAnalyticsPageview(request(f, {}, { page: "private/path" }))).status, 400);
  assert.equal((await f.handlers.handleAnalyticsPageview(request(f, {}, { page: "x".repeat(101) }))).status, 413);
  assert.equal(f.calls.length, 1);
});

test("pageview denies cross-origin, unprotected-edge and browser privacy opt-outs", async () => {
  const f = fixture();
  assert.equal((await f.handlers.handleAnalyticsPageview(request(f, { origin: "https://attacker.example" }))).status, 403);
  assert.equal((await f.handlers.handleAnalyticsPageview(request(f, { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal((await f.handlers.handleAnalyticsPageview(request(f, { dnt: "1" }))).status, 204);
  assert.equal(f.calls.length, 0);
  f.env.EDGE_PROTECTION_REQUIRED = "true";
  const denied = await f.handlers.handleAnalyticsPageview(request(f));
  assert.equal(denied.status, 503);
  assert.equal(f.calls.length, 0);
});

test("transport failure and aborted request cannot alter application outcomes", async () => {
  const f = fixture({}, async () => { throw new Error("synthetic credential-bearing URL error"); });
  await assert.doesNotReject(f.server.captureAnalytics(request(f), "generation", properties));
  const controller = new AbortController();
  controller.abort();
  const aborted = new Request(request(f), { signal: controller.signal });
  await f.server.captureAnalytics(aborted, "generation", properties);
  assert.equal(f.calls.length, 1);
});

test("browser path mapper never returns variable paths, queries, media or identifiers", () => {
  const f = fixture();
  assert.equal(f.consent.analyticsPage("/blue", ""), "blue");
  assert.equal(f.consent.analyticsPage("/tezu-homepage/flashloop/blue/", "/tezu-homepage/flashloop"), "blue");
  for (const path of ["/account/private", "/blue?token=synthetic", "/media/private", "/projects/" + jobId]) {
    assert.equal(f.consent.analyticsPage(path), null);
  }
});

function browserEnvironment() {
  let cookie = "";
  const document = new EventTarget();
  Object.defineProperty(document, "cookie", { get: () => cookie, set: (value) => { cookie = value.split(";")[0]; } });
  const channels = [];
  const messages = [];
  class PrivacyChannel extends EventTarget {
    constructor(name) { super(); this.name = name; channels.push(this); }
    postMessage(value) {
      messages.push(value);
      for (const channel of channels) if (channel !== this && channel.name === this.name && !channel.closed) channel.dispatchEvent(new Event("message"));
    }
    close() { this.closed = true; }
  }
  return { document, window: new EventTarget(), navigator: {}, location: { protocol: "https:" }, BroadcastChannel: PrivacyChannel, messages };
}

test("browser transport rechecks cookie and GPC/DNT, sends page enum only without referrer", async () => {
  const browser = browserEnvironment();
  const f = fixture({}, undefined, browser);
  const client = f.load(resolve(root, "lib/analytics/browser.ts"));
  const signal = new AbortController().signal;
  await client.captureBrowserPageview("/blue", policyVersion, signal);
  assert.equal(f.calls.length, 0);
  browser.document.cookie = f.consent.analyticsConsentCookie("granted", policyVersion, true);
  await client.captureBrowserPageview("/blue", policyVersion, signal);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/analytics");
  assert.equal(f.calls[0].options.referrerPolicy, "no-referrer");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].body)), { page: "blue" });
  browser.navigator.globalPrivacyControl = true;
  await client.captureBrowserPageview("/blue", policyVersion, signal);
  browser.navigator.globalPrivacyControl = false;
  browser.navigator.doNotTrack = "1";
  await client.captureBrowserPageview("/blue", policyVersion, signal);
  browser.navigator.doNotTrack = "0";
  browser.document.cookie = f.consent.analyticsConsentCookie("denied", policyVersion, true);
  await client.captureBrowserPageview("/blue", policyVersion, signal);
  assert.equal(f.calls.length, 1);
});

test("cross-tab revocation and focus refresh abort pending capture without broadcasting personal data", () => {
  const browser = browserEnvironment();
  const f = fixture({}, undefined, browser);
  const client = f.load(resolve(root, "lib/analytics/browser.ts"));
  const pending = new AbortController();
  let current;
  browser.document.cookie = f.consent.analyticsConsentCookie("granted", policyVersion, true);
  const first = client.monitorAnalyticsConsent(policyVersion, (state) => {
    current = state;
    if (state.blocked || state.choice !== "granted") pending.abort();
  });
  const second = client.monitorAnalyticsConsent(policyVersion, () => {});
  assert.equal(pending.signal.aborted, false);
  second.choose("denied");
  assert.equal(current.choice, "denied");
  assert.equal(pending.signal.aborted, true);
  assert.deepEqual(browser.messages, ["privacy-choice-changed"]);
  browser.navigator.globalPrivacyControl = true;
  browser.window.dispatchEvent(new Event("focus"));
  assert.equal(current.blocked, true);
  first.stop();
  second.stop();
});
