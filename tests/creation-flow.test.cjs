const assert = require("node:assert/strict");
const test = require("node:test");
const { getPromptError, validateAuthFields } = require("../src/components/sites/krea/creation-form.ts");
const { resolveTezuAppHome } = require("../src/components/sites/krea/app-links.ts");

test("a whitespace-only prompt cannot open signup", () => {
  assert.ok(getPromptError(" \n\t "));
  assert.equal(getPromptError("A cartoon fox crossing a bridge"), "");
});

test("signup rejects invalid email, short password and missing agreement", () => {
  const errors = validateAuthFields({ mode: "signup", email: "name@", password: "short", agreement: false });
  assert.deepEqual(Object.keys(errors).sort(), ["agreement", "email", "password"]);
});

test("valid signup accepts a trimmed email without changing the password", () => {
  assert.deepEqual(validateAuthFields({ mode: "signup", email: " creator@example.com ", password: " 123456 ", agreement: true }), {});
});

test("login accepts an existing short password and needs no signup agreement", () => {
  assert.deepEqual(validateAuthFields({ mode: "login", email: "creator@example.com", password: "old", agreement: false }), {});
});

test("login still rejects missing credentials", () => {
  assert.deepEqual(Object.keys(validateAuthFields({ mode: "login", email: "", password: "", agreement: false })).sort(), ["email", "password"]);
});

test("development links keep the separate local studio", () => {
  assert.equal(resolveTezuAppHome({ development: true }), "http://127.0.0.1:3000/");
});

test("production links retain the bundled studio under the homepage base path", () => {
  assert.equal(resolveTezuAppHome({ development: false, basePath: "/tezu-homepage" }), "/tezu-homepage/tezu/");
  assert.equal(resolveTezuAppHome({ development: false }), "/tezu/");
});

test("a deployment override keeps its path and one trailing slash", () => {
  assert.equal(resolveTezuAppHome({ development: true, override: " https://studio.example.com/creative " }), "https://studio.example.com/creative/");
});

test("unsupported or malformed overrides fall back to existing destinations", () => {
  for (const override of ["javascript:alert(1)", "not a URL", "https://user:password@example.com/"]) {
    assert.equal(resolveTezuAppHome({ development: false, override }), "/tezu/");
  }
});
