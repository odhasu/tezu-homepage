const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

class AuthFailure extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

function scenario(options = {}) {
  const env = { PROVIDER_DOWNLOAD_ORIGINS: "https://cdn.provider.example", AUTH_ORIGIN: "https://app.example", ...options.env };
  const dnsCalls = [];
  const requests = [];
  const deadlines = [];
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/security/provider-destinations.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = {
    "server-only": {},
    "@/lib/auth/security": { AuthFailure },
    "node:net": require("node:net"),
    "node:dns/promises": {
      async lookup(hostname, lookupOptions) {
        dnsCalls.push({ hostname, options: lookupOptions });
        if (options.lookup) return options.lookup();
        return options.answers ?? [{ address: "93.184.216.34", family: 4 }];
      },
    },
    "node:https": {
      request(url, requestOptions, callback) {
        const request = new EventEmitter();
        const response = new PassThrough();
        response.statusCode = options.status ?? 200;
        response.headers = { "content-type": "image/png", ...options.headers };
        const capture = { url, options: requestOptions, request, response, destroyed: false, pinned: [] };
        requests.push(capture);
        for (const all of [false, true]) requestOptions.lookup(url.hostname, { all }, (error, address, family) => {
          assert.equal(error, null);
          capture.pinned.push({ address, family });
        });
        request.destroy = () => { capture.destroyed = true; return request; };
        requestOptions.signal.addEventListener("abort", () => request.emit("error", new Error("aborted")), { once: true });
        request.end = () => queueMicrotask(() => {
          callback(response);
          if (options.hangResponse) return;
          for (const chunk of options.chunks ?? [Buffer.from("png")]) response.write(chunk);
          response.end();
        });
        return request;
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module,
    require(name) { assert.ok(name in imports, `Unexpected dependency ${name}`); return imports[name]; },
    URL, Buffer, process: { env },
    AbortSignal: {
      timeout(milliseconds) {
        assert.equal(milliseconds, 8000);
        const controller = new AbortController(); deadlines.push(controller); return controller.signal;
      },
      any: AbortSignal.any.bind(AbortSignal),
    },
  });
  return { ...module.exports, dnsCalls, requests, deadlines };
}

const outputUrl = "https://cdn.provider.example/results/video.png?token=private";

test("provider output allowlist is exact and denies absent or malformed configuration", () => {
  for (const env of [
    { PROVIDER_DOWNLOAD_ORIGINS: "" }, { PROVIDER_DOWNLOAD_ORIGINS: "*" },
    { PROVIDER_DOWNLOAD_ORIGINS: "https://cdn.provider.example/" },
    { PROVIDER_DOWNLOAD_ORIGINS: "http://cdn.provider.example" },
    { PROVIDER_DOWNLOAD_ORIGINS: "https://cdn.provider.example,https://127.0.0.1" },
  ]) assert.throws(() => scenario({ env }).validateProviderDownloadUrl(outputUrl), { status: 503 });
  const s = scenario({ env: { PROVIDER_DOWNLOAD_ORIGINS: "https://api.provider.example, https://cdn.provider.example" } });
  assert.equal(s.validateProviderDownloadUrl(outputUrl).href, outputUrl);
});

for (const value of [
  "http://cdn.provider.example/a", "file:///etc/passwd", "https://evil.example/a",
  "https://cdn.provider.example.evil.example/a", "https://cdn.provider.example@evil.example/a",
  "https://user:password@cdn.provider.example/a", "https://cdn.provider.example:8443/a",
  "https://cdn.provider.example:443/a", "https://CDN.provider.example/a", "https://cdn.provider.example./a",
  "https://127.0.0.1/a", "https://2130706433/a", "https://0x7f000001/a", "https://[::1]/a",
  "https://localhost/a", "https://foo.local/a", "https://foo.internal/a", "https://foo.home.arpa/a",
  "https://cdn.provider.example/a#fragment", "https://cdn.provider.example\\@evil.example/a",
  "https://cdn.provider.example/\nprivate", " https://cdn.provider.example/a",
]) test(`denies unsafe or unapproved URL: ${JSON.stringify(value)}`, () => {
  assert.throws(() => scenario().validateProviderDownloadUrl(value), { status: 400 });
});

test("callback requires server canonical application origin and exact reserved path", () => {
  const s = scenario();
  assert.equal(s.validateProviderCallbackUrl("https://app.example/api/providers/callback").href,
    "https://app.example/api/providers/callback");
  for (const value of [
    "https://evil.example/api/providers/callback", "https://app.example/other",
    "https://app.example/api/providers/callback?url=http://localhost",
    "https://app.example/api/providers/callback#fragment", "https://app.example:443/api/providers/callback",
    "https://app.example/api/providers/../providers/callback", "https://user@app.example/api/providers/callback",
  ]) assert.throws(() => s.validateProviderCallbackUrl(value), { status: 400 });
  assert.throws(() => scenario({ env: { AUTH_ORIGIN: "" } }).validateProviderCallbackUrl("https://app.example/api/providers/callback"), { status: 503 });
});

test("all private, reserved, mapped, and mixed DNS answers fail before opening transport", async () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.1.2",
    "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.51.100.1",
    "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "::ffff:127.0.0.1",
    "fc00::1", "fe80::1", "ff00::1", "64:ff9b::a00:1", "2001:db8::1", "2001::1", "2002:7f00:1::1", "3fff::1",
  ]) {
    const s = scenario({ answers: [{ address, family: address.includes(":") ? 6 : 4 }] });
    await assert.rejects(s.fetchProviderOutput(outputUrl, { maxBytes: 100 }), { status: 400 });
    assert.equal(s.requests.length, 0, address);
  }
  const s = scenario({ answers: [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }] });
  await assert.rejects(s.fetchProviderOutput(outputUrl, { maxBytes: 100 }), { status: 400 });
  assert.equal(s.requests.length, 0);
});

test("transport pins single validated public DNS answer with original TLS hostname and no pooling", async () => {
  const s = scenario();
  const output = await s.fetchProviderOutput(outputUrl, { maxBytes: 100 });
  assert.equal(Buffer.from(output.body).toString(), "png");
  assert.equal(output.byteSize, 3);
  assert.equal(output.contentType, "image/png");
  assert.equal(s.dnsCalls.length, 1);
  assert.equal(s.requests.length, 1);
  const transport = s.requests[0];
  assert.equal(transport.options.agent, false);
  assert.equal(transport.options.servername, "cdn.provider.example");
  assert.equal(transport.options.method, "GET");
  assert.equal(transport.options.headers["accept-encoding"], "identity");
  assert.equal(Object.keys(transport.options.headers).length, 1);
  assert.equal(transport.pinned[0].address, "93.184.216.34");
  assert.equal(transport.pinned[0].family, 4);
  assert.equal(transport.pinned[1].address[0].address, "93.184.216.34");
});

test("public IPv6 provider answer is pinned without permitting private IPv6 ranges", async () => {
  const s = scenario({ answers: [{ address: "2606:4700:4700::1111", family: 6 }] });
  await s.fetchProviderOutput(outputUrl, { maxBytes: 100 });
  assert.equal(s.requests[0].pinned[0].family, 6);
  assert.equal(s.requests[0].pinned[0].address, "2606:4700:4700::1111");
});

for (const status of [301, 302, 303, 307, 308, 404]) test(`does not follow response status ${status}`, async () => {
  const s = scenario({ status, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  await assert.rejects(s.fetchProviderOutput(outputUrl, { maxBytes: 100 }), { status: 502 });
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0].destroyed, true);
});

test("maximum byte limit applies to claimed length and streamed bytes", async () => {
  for (const options of [
    { headers: { "content-length": "101" } }, { headers: { "content-length": "-1" } },
    { chunks: [Buffer.alloc(75), Buffer.alloc(26)] },
  ]) {
    const s = scenario(options);
    await assert.rejects(s.fetchProviderOutput(outputUrl, { maxBytes: 100 }), { status: 413 });
    assert.equal(s.requests[0].destroyed, true);
  }
  for (const maxBytes of [0, -1, NaN, 1.5, 20 * 1024 * 1024 + 1]) {
    const s = scenario();
    await assert.rejects(s.fetchProviderOutput(outputUrl, { maxBytes }), { status: 400 });
    assert.equal(s.dnsCalls.length, 0);
  }
});

test("empty, truncated, and compressed output cannot pass verification boundary", async () => {
  for (const options of [
    { chunks: [] }, { headers: { "content-length": "4" } }, { headers: { "content-encoding": "gzip" } },
  ]) await assert.rejects(scenario(options).fetchProviderOutput(outputUrl, { maxBytes: 100 }), { status: 400 });
});

test("8s deadline includes DNS resolution and prevents transport after timeout", async () => {
  const s = scenario({ lookup: () => new Promise(() => {}) });
  const result = s.fetchProviderOutput(outputUrl, { maxBytes: 100 });
  s.deadlines[0].abort();
  await assert.rejects(result, { status: 502 });
  assert.equal(s.requests.length, 0);
});

test("caller cancellation remains effective during DNS and response streaming", async () => {
  const caller = new AbortController();
  const dns = scenario({ lookup: () => new Promise(() => {}) });
  const pendingDns = dns.fetchProviderOutput(outputUrl, { maxBytes: 100, signal: caller.signal });
  caller.abort();
  await assert.rejects(pendingDns, { status: 502 });
  const transportCaller = new AbortController();
  const transport = scenario({ hangResponse: true });
  const pendingResponse = transport.fetchProviderOutput(outputUrl, { maxBytes: 100, signal: transportCaller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  transportCaller.abort();
  await assert.rejects(pendingResponse, { status: 502 });
});
