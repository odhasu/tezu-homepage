import assert from "node:assert/strict";
import { test } from "node:test";
import { handleStagingProxy } from "../cloudflare/staging-proxy.mjs";

// Synthetic Worker transport only. No hosted Worker, Vercel or auth claim.
const publicOrigin = "https://flashloop-staging.fixture.workers.dev";
const upstreamOrigin = "https://fixture-staging.vercel.app";
const fixtureProof = "synthetic-proof-at-least-thirty-two-characters";
const settings = { ENABLED: "true", PUBLIC_ORIGIN: publicOrigin, UPSTREAM_ORIGIN: upstreamOrigin, EDGE_ORIGIN_SECRET: fixtureProof };
const privatePolicy = {
  "cache-control": "private, no-store", "cdn-cache-control": "no-store", "vercel-cdn-cache-control": "no-store",
  pragma: "no-cache", expires: "0",
};
function request(path = "/blue", options = {}) {
  return new Request(`${publicOrigin}${path}`, { ...options, headers: { "CF-Connecting-IP": "203.0.113.10", ...options.headers } });
}
function assertPrivate(response) {
  for (const [key, value] of Object.entries(privatePolicy)) assert.equal(response.headers.get(key), value);
}
async function assertNoProof(response) {
  assert.equal([...response.headers].some(([name, value]) => name.startsWith("x-flashloop-") || value.includes(fixtureProof)), false);
  assert.equal((await response.text()).includes(fixtureProof), false);
}

test("disabled Worker and invalid configuration make no upstream request", async () => {
  const configurations = [undefined, {}, { ...settings, ENABLED: "false" }, { ...settings, ENABLED: true },
    { ...settings, EDGE_ORIGIN_SECRET: "short" }, { ...settings, EDGE_ORIGIN_SECRET: " x".repeat(32) },
    { ...settings, PUBLIC_ORIGIN: `${publicOrigin}/` }, { ...settings, PUBLIC_ORIGIN: "http://fixture.workers.dev" },
    { ...settings, PUBLIC_ORIGIN: "https://user:password@fixture.workers.dev" },
    { ...settings, PUBLIC_ORIGIN: "https://127.0.0.1" }, { ...settings, PUBLIC_ORIGIN: "https://fixture.vercel.app" },
    { ...settings, PUBLIC_ORIGIN: `${publicOrigin}:8443` },
    { ...settings, UPSTREAM_ORIGIN: "https://outside.example" }, { ...settings, UPSTREAM_ORIGIN: `${upstreamOrigin}/path` },
    { ...settings, UPSTREAM_ORIGIN: `${upstreamOrigin}?key=synthetic` },
    { ...settings, UPSTREAM_ORIGIN: "https://user:password@fixture-staging.vercel.app" },
    { ...settings, UPSTREAM_ORIGIN: "http://fixture-staging.vercel.app" },
  ];
  for (const configuration of configurations) {
    const response = await handleStagingProxy(request(), configuration, () => { throw new Error("Must not fetch"); });
    assert.equal(response.status, 503);
    assertPrivate(response);
    await assertNoProof(response);
  }
});

test("Worker refuses alternate public addresses, spoofed Host and invalid network metadata", async () => {
  for (const input of [
    new Request("https://outside.example/blue", { headers: { "CF-Connecting-IP": "203.0.113.10" } }),
    request("/blue", { headers: { Host: "outside.example" } }),
    ...["", "unknown", "203.0.113.1, 203.0.113.2", "999.1.1.1", "001.1.1.1", "1.2.3", "2001:::1", "[2001:db8::1]"].map(ip => request("/blue", { headers: { "CF-Connecting-IP": ip } })),
  ]) {
    const response = await handleStagingProxy(input, settings, () => { throw new Error("Must not fetch"); });
    assert.equal(response.status, 403);
    assertPrivate(response);
    await assertNoProof(response);
  }
});

test("fixed upstream strips spoofed proof/forwarding headers and preserves browser CSRF context", async () => {
  let calls = 0;
  const input = request("/api/auth/signin?fixed=1", { method: "POST", body: "synthetic-body", headers: {
    Origin: publicOrigin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", Cookie: "fixture=value",
    "x-flashloop-edge-key": "attacker", "x-flashloop-public-host": "attacker.example", "x-flashloop-client-ip": "1.1.1.1",
    "X-Forwarded-Host": "attacker.example", "X-Forwarded-For": "1.1.1.1", Forwarded: "host=attacker.example",
    "X-Real-IP": "1.1.1.1", "CF-Ray": "attacker", "X-Vercel-Protection-Bypass": "attacker", Connection: "X-Drop-Me",
    "X-Drop-Me": "attacker", "Proxy-Authorization": "attacker",
  } });
  const response = await handleStagingProxy(input, settings, async (url, init) => {
    calls++;
    assert.equal(url, `${upstreamOrigin}/api/auth/signin?fixed=1`);
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(init.method, "POST");
    assert.equal(await new Response(init.body).text(), "synthetic-body");
    assert.equal(init.headers.get("Host"), "fixture-staging.vercel.app");
    assert.equal(init.headers.get("x-flashloop-edge-key"), fixtureProof);
    assert.equal(init.headers.get("x-flashloop-public-host"), "flashloop-staging.fixture.workers.dev");
    assert.equal(init.headers.get("x-flashloop-client-ip"), "203.0.113.10");
    assert.equal(init.headers.get("Origin"), publicOrigin);
    assert.equal(init.headers.get("Sec-Fetch-Site"), "same-origin");
    assert.equal(init.headers.get("Cookie"), "fixture=value");
    for (const name of ["Forwarded", "X-Forwarded-Host", "X-Forwarded-For", "CF-Connecting-IP", "X-Real-IP", "CF-Ray", "X-Vercel-Protection-Bypass", "Connection", "X-Drop-Me", "Proxy-Authorization"]) assert.equal(init.headers.get(name), null);
    return new Response("ok", { headers: { "x-flashloop-edge-key": fixtureProof, "x-flashloop-public-host": "private", "Cache-Control": "public, max-age=3600" } });
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assertPrivate(response);
  await assertNoProof(response);
});

test("double slash paths and query destination hints cannot change the upstream", async () => {
  const response = await handleStagingProxy(request("//outside.example/path?url=https://outside.example"), settings, async (url) => {
    const target = new URL(url);
    assert.equal(target.origin, upstreamOrigin);
    assert.equal(target.pathname, "//outside.example/path");
    return new Response("ok");
  });
  assert.equal(response.status, 200);
});

test("same-origin redirects are rewritten to public origin and never followed", async () => {
  for (const location of ["/auth/verify", "../verify?code=synthetic", `${upstreamOrigin}/account`, `${publicOrigin}/account`, "#part"]) {
    let calls = 0;
    const response = await handleStagingProxy(request("/api/auth/callback"), settings, async (_url, init) => {
      calls++;
      assert.equal(init.redirect, "manual");
      return new Response(null, { status: 303, headers: { Location: location, Refresh: `0;url=${upstreamOrigin}/unsafe` } });
    });
    assert.equal(calls, 1);
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get("Location"));
    assert.equal(target.origin, publicOrigin);
    assert.equal(response.headers.get("Refresh"), null);
    assertPrivate(response);
    await assertNoProof(response);
  }
});

test("outside/credential/protocol redirect targets never receive proof or a second fetch", async () => {
  for (const location of ["https://outside.example", "//outside.example/path", "http://fixture-staging.vercel.app/path", "https://user:password@fixture-staging.vercel.app/path", "javascript:alert(1)", "data:text/plain,test"]) {
    let calls = 0;
    const response = await handleStagingProxy(request(), settings, async () => {
      calls++;
      return new Response("sensitive upstream body", { status: 302, headers: { Location: location } });
    });
    assert.equal(calls, 1);
    assert.equal(response.status, 502);
    assertPrivate(response);
    await assertNoProof(response);
  }
});

test("private routes, errors, redirects, cookie and authorization responses never retain public caching", async () => {
  const cases = [
    ["/api", 200, {}, {}], ["/api/future", 200, {}, {}], ["/%61uth", 200, {}, {}], ["/api%2faccount", 200, {}, {}], ["/auth", 200, {}, {}], ["/auth/signup", 200, {}, {}],
    ["/account", 200, {}, {}], ["/account/billing", 200, {}, {}], ["/blue", 404, {}, {}], ["/blue", 503, {}, {}],
    ["/blue", 307, { Location: "/blue/" }, {}], ["/blue", 200, { "Set-Cookie": "fixture=value; Secure; HttpOnly; SameSite=Lax; Path=/" }, {}],
    ["/blue", 200, {}, { Cookie: "fixture=value" }], ["/blue", 200, {}, { Authorization: "Bearer synthetic" }],
  ];
  for (const [path, status, extraHeaders, requestHeaders] of cases) {
    const response = await handleStagingProxy(request(path, { headers: requestHeaders }), settings, async () => new Response("ok", {
      status, headers: { "Cache-Control": "public, max-age=3600", "CDN-Cache-Control": "public, s-maxage=3600", "Vercel-CDN-Cache-Control": "public, s-maxage=3600", Vary: "RSC, Next-Router-State-Tree", ...extraHeaders },
    }));
    assertPrivate(response);
    assert.equal(response.headers.get("Vary"), "RSC, Next-Router-State-Tree, Cookie, Authorization");
  }
});

test("public assets retain deliberate headers, but subrequests always bypass cache", async () => {
  const response = await handleStagingProxy(request("/_next/static/hash.js"), settings, async (_url, init) => {
    assert.equal(init.cache, "no-store");
    return new Response("asset", { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
  });
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
});

test("streaming and distinct host-only cookies survive the proxy without buffering", async () => {
  let finish;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("first")); finish = () => { controller.enqueue(new TextEncoder().encode("second")); controller.close(); }; } });
  const headers = new Headers();
  headers.append("Set-Cookie", "fixture-a=one; Secure; HttpOnly; SameSite=Lax; Path=/");
  headers.append("Set-Cookie", "fixture-b=two; Secure; HttpOnly; SameSite=Lax; Path=/");
  const response = await handleStagingProxy(request("/auth"), settings, async () => new Response(stream, { headers }));
  assert.equal(response.bodyUsed, false);
  assert.equal(response.headers.getSetCookie().length, 2);
  assert.equal(response.headers.getSetCookie().some(value => /domain=/i.test(value)), false);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
  finish();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "second");
  assert.equal((await reader.read()).done, true);
  assertPrivate(response);
});

test("IPv6 client metadata is preserved only in the proof-bound private header", async () => {
  const ip = "2001:db8::1";
  const response = await handleStagingProxy(request("/blue", { headers: { "CF-Connecting-IP": ip } }), settings, async (_url, init) => {
    assert.equal(init.headers.get("x-flashloop-client-ip"), ip);
    assert.equal(init.headers.get("CF-Connecting-IP"), null);
    return new Response("ok");
  });
  assert.equal(response.status, 200);
});

test("transport failure emits only fixed private text, never upstream diagnostics", async () => {
  const response = await handleStagingProxy(request(), settings, async () => { throw new Error(`${fixtureProof} https://signed.invalid/?token=synthetic`); });
  assert.equal(response.status, 502);
  assert.equal(response.headers.get("Location"), null);
  assertPrivate(response);
  await assertNoProof(response);
});
