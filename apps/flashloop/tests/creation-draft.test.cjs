const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = readFileSync(resolve(__dirname, "../src/lib/creation-draft.ts"), "utf8");
assert.ok(source.length > 100, "Draft implementation must be hydrated before verification");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const draft = { kind: "video", prompt: "A paper boat on a blue lake", model: "Kling 4.0", ratio: "16:9", quality: "1080p", count: "1", duration: "5s" };
function client(href = "https://app.example.test/auth") {
  const values = new Map();
  const location = { href };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, URL, window: { location }, sessionStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } });
  return { ...module.exports, values, location };
}

test("same-tab draft handoff is consumed once, without URL navigation or file data", () => {
  const api = client();
  assert.equal(api.saveCreationDraft(draft), true);
  assert.equal(JSON.stringify(api.consumeCreationDraft("video")), JSON.stringify(draft));
  assert.equal(api.consumeCreationDraft("video"), null);
  assert.equal(api.values.size, 0);
});

test("expired, corrupt and wrong-tool drafts are discarded", () => {
  const api = client();
  for (const raw of ["{", JSON.stringify({ ...draft, expires: Date.now() - 1 }), JSON.stringify({ ...draft, expires: Date.now() + 3600000 }), JSON.stringify({ ...draft, prompt: 1, expires: Date.now() + 1000 })]) {
    api.values.set("flashloop.creation-draft.v1", raw);
    assert.equal(api.consumeCreationDraft("video"), null);
    assert.equal(api.values.size, 0);
  }
  api.saveCreationDraft(draft);
  assert.equal(api.consumeCreationDraft("image"), null);
  assert.equal(api.values.size, 0);
});

test("drafts have bounded prompt length and can be explicitly cleared", () => {
  const api = client();
  api.saveCreationDraft({ ...draft, prompt: "a".repeat(7000) });
  assert.equal(api.consumeCreationDraft("video").prompt.length, 6000);
  api.saveCreationDraft(draft);
  api.clearCreationDraft();
  assert.equal(api.values.size, 0);
});

test("auth handoff keeps only a valid image/video choice and does not consume the draft", () => {
  const api = client();
  assert.equal(api.pendingCreationKind(), "video");
  api.saveCreationDraft({ ...draft, kind: "image" });
  assert.equal(api.pendingCreationKind(), "image");
  assert.equal(api.values.size, 1);
  assert.equal(api.consumeCreationDraft("image").prompt, draft.prompt);
  api.values.set("flashloop.creation-draft.v1", JSON.stringify({ kind: "https://invalid.example", expires: Date.now() + 1000 }));
  assert.equal(api.pendingCreationKind(), "video");
  api.values.set("flashloop.creation-draft.v1", JSON.stringify({ kind: "image", expires: Date.now() - 1 }));
  assert.equal(api.pendingCreationKind(), "video");
});

test("tool preference survives a fixed same-tab email callback with draft, query, preference precedence", () => {
  const api = client("https://app.example.test/auth/signup?kind=image");
  api.rememberCreationKind(api.browserCreationKind());
  assert.equal(api.pendingCreationKind(), "image");
  assert.equal(api.pendingCreationKind("video"), "video");
  assert.equal(api.creationContinuationPath("/account", api.pendingCreationKind()), "/account?kind=image");
  api.saveCreationDraft(draft);
  assert.equal(api.pendingCreationKind("image"), "video");
  assert.equal(api.values.size, 2);
  api.clearCreationDraft();
  assert.equal(api.values.size, 0);
  assert.equal(api.pendingCreationKind(), "video");
});

test("navigation accepts only one exact tool choice and never reflects return URLs or prompt text", () => {
  const api = client();
  for (const value of [undefined, "", "Image", "image&returnTo=https://invalid.example", "https://invalid.example", ["image", "video"], {}]) {
    assert.equal(api.readCreationKind(value), undefined);
    assert.equal(api.creationContinuationPath("/auth/verify", value), "/auth/verify");
  }
  for (const path of ["/auth", "/auth/verify", "/account"]) {
    assert.equal(api.creationContinuationPath(path, "image"), `${path}?kind=image`);
    assert.equal(api.creationContinuationPath(path, "video"), `${path}?kind=video`);
  }
  assert.equal(client("https://app.example.test/auth?kind=image&prompt=private-test&returnTo=https://invalid.example").browserCreationKind(), "image");
  assert.equal(client("https://app.example.test/auth?kind=image&kind=video").browserCreationKind(), undefined);
  assert.equal(client("https://app.example.test/auth?kind=https%3A%2F%2Finvalid.example").browserCreationKind(), undefined);
});

test("expired or malformed saved tool preferences cannot override the default", () => {
  const api = client();
  for (const value of ["{", JSON.stringify({ kind: "image", expires: Date.now() - 1 }), JSON.stringify({ kind: "image", expires: Date.now() + 3600000 }), JSON.stringify({ kind: "https://invalid.example", expires: Date.now() + 1000 })]) {
    api.values.set("flashloop.creation-kind.v1", value);
    assert.equal(api.pendingCreationKind(), "video");
  }
});

test("blocked browser storage never silently drops a draft and navigates", () => {
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, sessionStorage: {
    getItem() { throw new Error("Storage unavailable"); },
    setItem() { throw new Error("Storage unavailable"); },
    removeItem() { throw new Error("Storage unavailable"); },
  } });
  assert.equal(module.exports.saveCreationDraft(draft), false);
  assert.equal(module.exports.consumeCreationDraft("video"), null);
  assert.doesNotThrow(() => module.exports.clearCreationDraft());
  assert.doesNotThrow(() => module.exports.rememberCreationKind("image"));
  assert.equal(module.exports.pendingCreationKind("image"), "image");
});

function descendants(element) {
  if (!element || typeof element !== "object") return [];
  return [element, ...[element.props?.children].flat(Infinity).flatMap(descendants)];
}

// Execute the actual auth component callbacks with controlled provider replies.
// This verifies navigation only, not provider signup, CAPTCHA or browser security.
function authComponent(file, creation, { session = { authenticated: true, emailConfirmed: true, verified: true }, confirmationRequired = false } = {}) {
  const state = [], refs = [], effects = [], navigation = [], authCalls = [];
  let stateIndex = 0, refIndex = 0, mounted = false;
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!mounted) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); },
    useCallback(callback) { return callback; },
    useEffect(callback) { if (!mounted) effects.push(callback); },
  };
  const challenge = function TurnstileFixture() {};
  const api = {
    async postAuth(action) {
      authCalls.push(action);
      if (action === "verify") session = { ...session, authenticated: true, emailConfirmed: true, verified: true };
      return { ok: true, confirmationRequired };
    },
    async getAuthSession() { return session; },
    authErrorMessage: () => "Controlled failure", AuthRateLimitError: class extends Error {}, AuthRetryError: class extends Error {},
  };
  const imports = {
    react: hooks,
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: "fragment" },
    "@/lib/local-path": { localPath: (path) => path },
    "@/lib/creation-draft": creation,
    "./auth-api": api,
    "./TurnstileChallenge": { TurnstileChallenge: challenge },
    "./useAuthRetry": { useAuthRetry: () => ({ retrySeconds: 0, retrying: false, startRetry() {} }) },
  };
  const source = readFileSync(resolve(__dirname, "../src/components/auth", file), "utf8");
  assert.ok(source.length > 100, "Auth component must be hydrated");
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, require(name) { assert.ok(name in imports, name); return imports[name]; },
    window: { location: {
      href: creation.location.href,
      assign: (path) => navigation.push(path), replace: (path) => navigation.push(path),
    } },
    process: { env: { NEXT_PUBLIC_AUTH_ENABLED: "true", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-fixture", NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: "true" } },
    FormData: class { get(name) { return name === "email" ? "fixture@example.invalid" : "public-fixture-password"; } },
    AbortController, URL, setTimeout: () => 1, clearTimeout() {}, Error,
  });
  function render(props = {}) {
    stateIndex = refIndex = 0;
    const component = module.exports.AuthForm ?? module.exports.SessionVerification;
    const tree = component(props);
    mounted = true;
    return tree;
  }
  return { render, effects, navigation, authCalls, challenge };
}

test("direct image sign-in carries its allowlisted tool into verification and the authenticated dashboard", async () => {
  const api = client("https://app.example.test/auth?kind=image&prompt=private-test&returnTo=https://invalid.example");
  const signin = authComponent("AuthForm.tsx", api);
  descendants(signin.render()).find((node) => node.type === signin.challenge).props.onTokens(["first-fixture", "second-fixture"]);
  await descendants(signin.render()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: {} });
  assert.deepEqual(signin.authCalls, ["signin"]);
  assert.deepEqual(signin.navigation, ["/auth/verify?kind=image"]);
  api.location.href = `https://app.example.test${signin.navigation[0]}`;
  const verification = authComponent("SessionVerification.tsx", api);
  verification.render();
  const cleanup = verification.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(verification.navigation, ["/account?kind=image"]);
  cleanup();
});

test("Google sign-in preserves the allowlisted tool for the OAuth callback", () => {
  const api = client("https://app.example.test/auth?kind=image");
  const signin = authComponent("AuthForm.tsx", api);
  const google = descendants(signin.render()).find((node) => node.type === "button" && node.props.children === "Continue with Google");
  assert.ok(google, "Google sign-in button must be present when runtime auth is enabled");
  google.props.onClick();
  assert.deepEqual(signin.navigation, ["/api/auth/google?kind=image"]);
  assert.equal(api.pendingCreationKind(), "image");
});

test("a verified existing session opens the chosen dashboard directly from sign-in", async () => {
  const api = client("https://app.example.test/auth?kind=image");
  const signin = authComponent("AuthForm.tsx", api);
  signin.render();
  const cleanup = signin.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signin.navigation, ["/account?kind=image"]);
  cleanup();
});

test("an unverified session continues security verification before the dashboard", async () => {
  const api = client("https://app.example.test/auth?kind=video");
  const signin = authComponent("AuthForm.tsx", api, { session: { authenticated: true, emailConfirmed: true, verified: false } });
  signin.render();
  const cleanup = signin.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signin.navigation, ["/auth/verify?kind=video"]);
  cleanup();
});

test("callback failures remain on sign-in with fixed recovery text", async () => {
  const api = client("https://app.example.test/auth?authError=callback&error_description=private-fixture&kind=image");
  const signin = authComponent("AuthForm.tsx", api);
  signin.render();
  const cleanup = signin.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(signin.navigation, []);
  const alert = descendants(signin.render()).find((node) => node.props.role === "alert");
  assert.equal(alert.props.children, "Sign-in could not finish. Try again, or create an account with email first.");
  cleanup();
});

test("signup remembers only the tool for the exact same-tab email callback and draft choice keeps precedence", async () => {
  const api = client("https://app.example.test/auth/signup?kind=image");
  const signup = authComponent("AuthForm.tsx", api, { confirmationRequired: true });
  descendants(signup.render({ initialMode: "signup" })).find((node) => node.type === signup.challenge).props.onTokens(["first-fixture", "second-fixture"]);
  await descendants(signup.render()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: {} });
  assert.deepEqual(signup.authCalls, ["signup"]);
  assert.deepEqual(signup.navigation, []);
  api.location.href = "https://app.example.test/auth/verify";
  const verification = authComponent("SessionVerification.tsx", api, { session: { authenticated: true, emailConfirmed: true, verified: false } });
  verification.render();
  const cleanup = verification.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  descendants(verification.render()).find((node) => node.type === verification.challenge).props.onTokens(["verify-fixture"]);
  await descendants(verification.render()).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(verification.authCalls, ["verify"]);
  assert.deepEqual(verification.navigation, ["/account?kind=image"]);
  assert.equal(api.pendingCreationKind(), "image");
  api.saveCreationDraft(draft);
  assert.equal(api.pendingCreationKind("image"), "video");
  cleanup();
});

test("the actual protected account page retains an unverified tool choice and rejects array or URL choices", async () => {
  const api = client();
  let authenticated = false;
  const dashboard = function DashboardFixture() {};
  const imports = {
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "next/navigation": { redirect(path) { const error = new Error("Controlled redirect"); error.path = path; throw error; } },
    "next/headers": { headers: async () => new Headers() },
    "@/lib/auth/server": { authClients: async () => ({}), requireProtectedSession: async () => {
      if (!authenticated) throw new Error("Unverified fixture");
      return { credits: 0 };
    } },
    "@/lib/local-path": { localPath: (path) => `/flashloop${path}` },
    "@/lib/security/edge-origin": { requireEdgeOrigin() {} },
    "@/components/dashboard/GenerationDashboard": { GenerationDashboard: dashboard },
    "@/lib/creation-draft": api,
  };
  const module = { exports: {} };
  const source = readFileSync(resolve(__dirname, "../src/app/account/page.runtime.tsx"), "utf8");
  assert.ok(source.length > 100);
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module, exports: module.exports, require(name) { assert.ok(name in imports, name); return imports[name]; },
  });
  await assert.rejects(module.exports.default({ searchParams: Promise.resolve({ kind: "image", returnTo: "https://invalid.example", prompt: "private-test" }) }),
    (error) => error.path === "/flashloop/auth/verify?kind=image");
  for (const kind of [["image", "video"], "https://invalid.example", undefined]) {
    await assert.rejects(module.exports.default({ searchParams: Promise.resolve({ kind }) }),
      (error) => error.path === "/flashloop/auth/verify");
  }
  authenticated = true;
  const result = await module.exports.default({ searchParams: Promise.resolve({ kind: "image" }) });
  assert.equal(result.type, dashboard);
  assert.equal(result.props.kind, "image");
  assert.equal(result.props.runtime, true);
});

test("an unverified image account returns to image sign-in without forwarding arbitrary URL fields", async () => {
  const api = client("https://app.example.test/auth/verify?kind=image&returnTo=https://invalid.example");
  const verification = authComponent("SessionVerification.tsx", api, { session: { authenticated: false, verified: false } });
  verification.render();
  const cleanup = verification.effects[0]();
  await new Promise((resolve) => setImmediate(resolve));
  const signin = descendants(verification.render()).find((node) => node.type === "a" && node.props.className === "auth-primary");
  signin.props.onClick({ preventDefault() {} });
  assert.deepEqual(verification.navigation, ["/auth?kind=image"]);
  cleanup();
});
