const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = readFileSync(resolve(__dirname, "../src/lib/private-requests.ts"), "utf8");
assert.ok(source.length > 100, "Hydrate the implementation before verification");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleValue = { exports: {} };
vm.runInNewContext(code, { module: moduleValue, exports: moduleValue.exports, AbortController, Map });
const { createPrivateRequests } = moduleValue.exports;

function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

test("responses cannot start without a fresh UI session binding", () => {
  const requests = createPrivateRequests();
  assert.equal(requests.begin("projects"), null);
  requests.bind("fixture-session-a");
  const request = requests.begin("projects");
  assert.equal(request.current(), true);
  requests.reset();
  assert.equal(request.current(), false);
  assert.equal(request.signal.aborted, true);
  assert.equal(requests.begin("projects"), null);
});

test("an old account response cannot overwrite a newly validated account before effect cleanup", async () => {
  const requests = createPrivateRequests();
  const slowA = deferred();
  let displayed = [];
  requests.bind("fixture-session-a");
  const a = requests.begin("projects");
  const late = slowA.promise.then((rows) => { if (a.current()) displayed = rows; });
  requests.reset(); // Synchronous invalidation at the beginning of revalidation.
  requests.bind("fixture-session-b");
  const b = requests.begin("projects");
  if (b.current()) displayed = ["B project"];
  slowA.resolve(["A private project"]);
  await late;
  assert.deepEqual(displayed, ["B project"]);
  a.cancel(); // Old passive-effect cleanup cannot cancel B's current request.
  assert.equal(b.current(), true);
  assert.equal(b.signal.aborted, false);
});

test("revalidation invalidates late responses even when the same session is rebound", () => {
  const requests = createPrivateRequests();
  requests.bind("fixture-session-a");
  const old = requests.begin("jobs");
  requests.reset();
  requests.bind("fixture-session-a");
  assert.equal(old.current(), false);
  assert.equal(requests.begin("jobs").current(), true);
});

test("changing projects cancels the previous history without cancelling project metadata", () => {
  const requests = createPrivateRequests();
  requests.bind("fixture-session-a");
  const projects = requests.begin("projects");
  const oldHistory = requests.begin("jobs");
  requests.cancel("jobs");
  const newHistory = requests.begin("jobs");
  assert.equal(oldHistory.current(), false);
  assert.equal(oldHistory.signal.aborted, true);
  assert.equal(newHistory.current(), true);
  assert.equal(projects.current(), true);
});

test("logout/page-hide invalidation aborts every private read channel", () => {
  const requests = createPrivateRequests();
  requests.bind("fixture-session-a");
  const reads = [requests.begin("projects"), requests.begin("jobs")];
  requests.reset();
  for (const request of reads) {
    assert.equal(request.signal.aborted, true);
    assert.equal(request.current(), false);
  }
});
