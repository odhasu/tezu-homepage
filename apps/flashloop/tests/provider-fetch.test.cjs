const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function scenario(fetcher = async () => new Response("ok")) {
  const deadlines = [];
  const calls = [];
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/security/provider-fetch.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module,
    require(name) { assert.equal(name, "server-only"); return {}; },
    Request,
    AbortSignal: {
      timeout(milliseconds) {
        assert.equal(milliseconds, 8000);
        const controller = new AbortController();
        deadlines.push(controller);
        return controller.signal;
      },
      any: AbortSignal.any.bind(AbortSignal),
    },
    fetch(input, options) { calls.push({ input, options }); return fetcher(input, options); },
  });
  return { ...module.exports, deadlines, calls };
}

function hangingFetch(_input, { signal }) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("provider fetch passes request options and always installs an 8000ms deadline", async () => {
  const s = scenario();
  const headers = { "content-type": "application/json" };
  const result = await s.boundedProviderFetch("https://provider.example.test", {
    method: "POST", headers, body: "{}", cache: "no-store",
  });
  assert.equal(await result.text(), "ok");
  assert.equal(s.calls[0].options.method, "POST");
  assert.equal(s.calls[0].options.headers, headers);
  assert.equal(s.calls[0].options.body, "{}");
  assert.equal(s.calls[0].options.cache, "no-store");
  assert.ok(s.calls[0].options.signal instanceof AbortSignal);
  assert.equal(s.deadlines.length, 1);
});

test("provider deadline cancels hanging request even without caller signal", async () => {
  const s = scenario(hangingFetch);
  const result = s.boundedProviderFetch("https://provider.example.test", { signal: null });
  s.deadlines[0].abort(new DOMException("Deadline exceeded.", "TimeoutError"));
  await assert.rejects(result, { name: "TimeoutError" });
});

test("Auth and account provider requests cannot opt into browser or Next data caching", async () => {
  const s = scenario();
  for (const cache of [undefined, "force-cache", "default", "reload", "only-if-cached"]) {
    await s.boundedProviderFetch("https://provider.example.test", { cache, next: { revalidate: 3600, tags: ["account"] } });
    assert.equal(s.calls.at(-1).options.cache, "no-store");
    assert.equal(s.calls.at(-1).options.next, undefined);
  }
  const request = new Request("https://provider.example.test", { cache: "force-cache" });
  await s.boundedProviderFetch(request);
  assert.equal(s.calls.at(-1).options.cache, "no-store");
  assert.equal(s.calls.at(-1).input, request);
});

test("caller init signal can cancel before mandatory deadline", async () => {
  const s = scenario(hangingFetch);
  const caller = new AbortController();
  const result = s.boundedProviderFetch("https://provider.example.test", { signal: caller.signal });
  caller.abort(new DOMException("Caller cancelled.", "AbortError"));
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(s.deadlines[0].signal.aborted, false);
});

test("Request signal remains effective alongside separate init signal", async () => {
  const s = scenario(hangingFetch);
  const requestController = new AbortController();
  const initController = new AbortController();
  const request = new Request("https://provider.example.test", { signal: requestController.signal });
  const result = s.boundedProviderFetch(request, { signal: initController.signal });
  requestController.abort(new DOMException("Request cancelled.", "AbortError"));
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(initController.signal.aborted, false);
});

test("already aborted caller request cannot lose cancellation", async () => {
  const s = scenario(hangingFetch);
  const caller = new AbortController();
  caller.abort(new DOMException("Cancelled earlier.", "AbortError"));
  await assert.rejects(s.boundedProviderFetch("https://provider.example.test", { signal: caller.signal }), { name: "AbortError" });
});

test("each provider request receives independent timeout scope", async () => {
  const s = scenario(hangingFetch);
  const first = s.boundedProviderFetch("https://provider.example.test/one");
  const second = s.boundedProviderFetch("https://provider.example.test/two");
  s.deadlines[0].abort(new DOMException("First timed out.", "TimeoutError"));
  await assert.rejects(first, { name: "TimeoutError" });
  assert.equal(s.calls[1].options.signal.aborted, false);
  s.deadlines[1].abort(new DOMException("Second timed out.", "TimeoutError"));
  await assert.rejects(second, { name: "TimeoutError" });
});
