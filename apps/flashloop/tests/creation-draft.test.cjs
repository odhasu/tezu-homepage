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
function client() {
  const values = new Map();
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, sessionStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } });
  return { ...module.exports, values };
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
});
