const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(resolve(__dirname, path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import ${name}`);
    },
    URL, Date, AbortController, setTimeout, clearTimeout,
    ...globals,
  });
  return module.exports;
}

const catalog = load("../src/lib/billing/catalog.ts");
const client = load("../src/components/billing/billing-client.ts", { "@/lib/billing/catalog": catalog });

test("Whop navigation rejects alternate schemes, credential hosts, spoofed hosts and unexpected URLs", () => {
  for (const url of [
    "javascript:alert(1)", "data:text/html,unsafe", "http://whop.com/checkout/plan_test", "//whop.com/checkout/plan_test",
    "https://whop.com.evil.example/checkout", "https://whop.com@evil.example/checkout", "https://evil.example@whop.com/checkout",
    "https://whop.com:444/checkout", "https://whop.com/checkout#secret", "https://not-whop.com/checkout",
    "https://arbitrary.whop.com/checkout", "https://evil.example/?next=https://whop.com", "/account/billing",
  ]) assert.equal(client.whopNavigationUrl({ url }), null, url);
  for (const value of [null, {}, { url: [] }, { url: "https://whop.com/" + "x".repeat(4096) }]) {
    assert.equal(client.whopNavigationUrl(value), null);
  }
  for (const url of ["https://whop.com/checkout/plan_test", "https://sandbox.whop.com/checkout/plan_test", "https://api.whop.com/oauth/authorize?state=fixture"]) {
    assert.equal(client.whopNavigationUrl({ url }), url);
  }
});

test("billing DTO rejects corrupt identity-independent state and drops unsolicited personal fields", () => {
  const valid = {
    linked: true, available: true, credits: 270,
    subscription: { tier: "starter", status: "active", periodEnd: "2026-12-05T12:00:00.000Z", cancelAtPeriodEnd: false },
  };
  const parsed = client.parseBillingSummary({ ...valid, email: "private@example.invalid", signedUrl: "https://private.example.invalid/?signature=fixture", subscription: { ...valid.subscription, membershipId: "mem_private", manageUrl: "https://whop.com/manage/private" } });
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), valid);
  for (const value of [
    { ...valid, credits: -1 }, { ...valid, credits: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, credits: "270" },
    { ...valid, linked: "true" }, { ...valid, available: undefined }, { ...valid, subscription: undefined },
    { ...valid, subscription: { ...valid.subscription, tier: "foreign" } },
    { ...valid, subscription: { ...valid.subscription, status: "private content" } },
    { ...valid, subscription: { ...valid.subscription, periodEnd: "invalid" } },
  ]) assert.equal(client.parseBillingSummary(value), null);
});

// This harness executes the real lifecycle callbacks. It is not a browser or
// a claim about BFCache/CDN behavior; deployed two-account acceptance is separate.
function dashboardHarness() {
  const state = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let mounted = false;
  const effects = [];
  const events = new Map();
  const timers = new Map();
  const calls = [];
  let nextTimer = 0;
  const document = { visibilityState: "visible", addEventListener: (name, handler) => events.set(name, handler), removeEventListener: (name) => events.delete(name) };
  const window = {
    addEventListener: (name, handler) => events.set(name, handler), removeEventListener: (name) => events.delete(name),
    setTimeout: (handler) => { const id = ++nextTimer; timers.set(id, handler); return id; },
    clearTimeout: (id) => timers.delete(id), location: { assign() {} },
  };
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!mounted) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial) { const index = refIndex++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
    useCallback(callback) { return callback; },
    useEffect(callback) { if (!mounted) effects.push(callback); },
  };
  const component = load("../src/components/billing/BillingDashboard.tsx", {
    react: hooks,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" },
    "@/lib/billing/catalog": catalog,
    "@/lib/local-path": { localPath: (path) => path },
    "./billing-client": client,
    "./billing.module.css": { default: {} },
  }, {
    document, window,
    crypto: { randomUUID: () => "5c9464f1-0d68-4c30-b421-d25fc41b3e4b" },
    fetch: (url, options) => new Promise((resolveResponse) => calls.push({ url, options, resolveResponse })),
  });
  function render() {
    stateIndex = 0;
    refIndex = 0;
    const result = component.BillingDashboard({ initialTier: "starter" });
    mounted = true;
    return result;
  }
  render();
  const cleanup = effects[0]();
  const firstTimer = timers.values().next().value;
  firstTimer();
  return { state, calls, document, render, cleanup, emit: (name, event) => events.get(name)?.(event) };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("hidden account status is cleared and a late previous-account response cannot replace refreshed status", async () => {
  const harness = dashboardHarness();
  try {
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].options.cache, "no-store");
    const oldRequest = harness.calls[0];
    harness.document.visibilityState = "hidden";
    harness.emit("visibilitychange");
    assert.equal(harness.state[0], null);
    assert.equal(oldRequest.options.signal.aborted, true);
    harness.document.visibilityState = "visible";
    harness.emit("visibilitychange");
    assert.equal(harness.calls.length, 2);
    harness.calls[1].resolveResponse(Response.json({ linked: false, available: true, credits: 0, subscription: null }));
    await settle();
    assert.equal(harness.state[0].credits, 0);
    oldRequest.resolveResponse(Response.json({ linked: true, available: true, credits: 9000, subscription: null }));
    await settle();
    assert.equal(harness.state[0].credits, 0);
    assert.equal(harness.state[0].linked, false);
    harness.emit("pagehide");
    assert.equal(harness.state[0], null);
    harness.emit("pageshow", { persisted: true });
    assert.equal(harness.calls.length, 3);
    assert.equal(harness.calls[2].options.cache, "no-store");
    harness.calls[2].resolveResponse(Response.json({ linked: false, available: true, credits: 0, subscription: null }));
    await settle();
  } finally { harness.cleanup(); }
});

function descendants(element) {
  if (element === null || element === undefined || typeof element !== "object") return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(descendants)];
}

test("billing mutation sends same-origin anti-CSRF header and keeps one request key across an ambiguous retry", async () => {
  const harness = dashboardHarness();
  try {
    harness.calls[0].resolveResponse(Response.json({ linked: true, available: true, credits: 0, subscription: null }));
    await settle();
    const form = descendants(harness.render()).find((element) => element.type === "form");
    assert.ok(form);
    form.props.onSubmit({ preventDefault() {} });
    assert.equal(harness.calls.length, 2);
    const first = harness.calls[1];
    assert.equal(first.url, "/api/checkout");
    assert.equal(first.options.headers["x-requested-with"], "flashloop");
    assert.equal(first.options.cache, "no-store");
    assert.equal(first.options.credentials, "same-origin");
    first.resolveResponse(new Response(null, { status: 503 }));
    await settle();
    form.props.onSubmit({ preventDefault() {} });
    assert.equal(harness.calls.length, 3);
    assert.equal(harness.calls[2].options.body, first.options.body);
    harness.calls[2].resolveResponse(new Response(null, { status: 503 }));
    await settle();
  } finally { harness.cleanup(); }
});
