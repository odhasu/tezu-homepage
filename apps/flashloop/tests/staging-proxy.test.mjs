import assert from "node:assert/strict";
import { test } from "node:test";
import { handleStagingProxy } from "../cloudflare/staging-proxy.mjs";

// Synthetic Worker transport only. No hosted Worker, Vercel or auth claim.
const publicOrigin = "https://flashloop-staging.fixture.workers.dev";
const upstreamOrigin = "https://fixture-staging.vercel.app";
const providerOrigin = "https://fixture-project.supabase.co";
const fixtureProof = "synthetic-proof-at-least-thirty-two-characters";
const settings = { ENABLED: "true", PUBLIC_ORIGIN: publicOrigin, UPSTREAM_ORIGIN: upstreamOrigin, EDGE_ORIGIN_SECRET: fixtureProof };
const googleSettings = { ...settings, AUTH_PROVIDER_ORIGIN: providerOrigin };
const privatePolicy = {
  "cache-control": "private, no-store", "cdn-cache-control": "no-store", "vercel-cdn-cache-control": "no-store",
  pragma: "no-cache", expires: "0",
};
function request(path = "/blue", options = {}) {
  return new Request(`${publicOrigin}${path}`, { ...options, headers: { "CF-Connecting-IP": "203.0.113.10", ...options.headers } });
}
function googleLocation(edit = () => {}) {
  const location = new URL(`${providerOrigin}/auth/v1/authorize`);
  location.searchParams.set("provider", "google");
  location.searchParams.set("redirect_to", `${publicOrigin}/api/auth/callback`);
  location.searchParams.set("code_challenge", "synthetic");
  location.searchParams.set("code_challenge_method", "s256");
  edit(location);
  return location.toString();
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
    ...[null, "", true, "http://fixture-project.supabase.co", `${providerOrigin}/`, `${providerOrigin}/auth/v1/authorize`,
      `${providerOrigin}?provider=google`, `${providerOrigin}#fragment`, `${providerOrigin}:8443`,
      "https://user:password@fixture-project.supabase.co", "https://fixture-project.supabase.co:443",
      "https://FIXTURE-PROJECT.supabase.co", "https://supabase.co", "https://fixture.supabase.co.outside.example",
      "https://nested.fixture.supabase.co", "https://auth.example", "https://-fixture.supabase.co",
    ].map(AUTH_PROVIDER_ORIGIN => ({ ...settings, AUTH_PROVIDER_ORIGIN })),
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

test("explicit Google authorize redirect preserves the provider URL, cookies and private policy without a second fetch", async () => {
  const location = googleLocation(url => url.searchParams.set("prompt", "select_account"));
  let calls = 0;
  const headers = new Headers({ Location: location, Refresh: `0;url=${providerOrigin}`, "x-flashloop-edge-key": fixtureProof,
    "Cache-Control": "public, max-age=3600" });
  headers.append("Set-Cookie", "fixture-pkce=verifier; Secure; HttpOnly; SameSite=Lax; Path=/");
  headers.append("Set-Cookie", "flashloop_auth_kind=image; Secure; HttpOnly; SameSite=Lax; Path=/");
  const response = await handleStagingProxy(request("/api/auth/google?kind=image"), googleSettings, async (url, init) => {
    calls++;
    assert.equal(url, `${upstreamOrigin}/api/auth/google?kind=image`);
    assert.equal(init.redirect, "manual");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.get("x-flashloop-edge-key"), fixtureProof);
    return new Response(null, { status: 303, headers });
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), location);
  assert.equal(response.headers.get("Refresh"), null);
  assert.equal(response.headers.getSetCookie().length, 2);
  assertPrivate(response);
  await assertNoProof(response);
});

test("Google provider exception requires an explicit binding, exact GET route and 303 status", async () => {
  const cases = [
    ["binding omitted", "/api/auth/google", "GET", 303, settings],
    ...["HEAD", "POST", "OPTIONS"].map(method => [method, "/api/auth/google", method, 303, googleSettings]),
    ...[200, 301, 302, 307, 308].map(status => [String(status), "/api/auth/google", "GET", status, googleSettings]),
    ...["/blue", "/api/auth/callback", "/api/auth/google/", "/api/auth/%67oogle", "/api/auth/google/other",
      "/flashloop/api/auth/google", "//api/auth/google"].map(path => [path, path, "GET", 303, googleSettings]),
  ];
  for (const [label, path, method, status, configuration] of cases) {
    let calls = 0;
    const response = await handleStagingProxy(request(path, { method }), configuration, async () => {
      calls++;
      return new Response("sensitive upstream body", { status, headers: { Location: googleLocation() } });
    });
    assert.equal(calls, 1, label);
    assert.equal(response.status, 502, label);
    assert.equal(response.headers.get("Location"), null, label);
    assertPrivate(response);
    await assertNoProof(response);
  }
});

test("Google provider exception rejects changed origins, paths, credentials, fragments and ambiguous query values", async () => {
  const cases = [
    ["different Supabase project", googleLocation(url => { url.hostname = "different-project.supabase.co"; })],
    ["lookalike suffix", googleLocation(url => { url.hostname = "fixture-project.supabase.co.outside.example"; })],
    ["non-HTTPS", googleLocation(url => { url.protocol = "http:"; })],
    ["custom port", googleLocation(url => { url.port = "8443"; })],
    ["credentials", googleLocation(url => { url.username = "fixture"; url.password = "password"; })],
    ["fragment", googleLocation(url => { url.hash = "fragment"; })],
    ...["/auth/v1/authorize/", "/auth/v1/token", "/AUTH/v1/authorize", "/auth/v1/%61uthorize"].map(path => [path, googleLocation(url => { url.pathname = path; })]),
    ["missing provider", googleLocation(url => url.searchParams.delete("provider"))],
    ["changed provider", googleLocation(url => url.searchParams.set("provider", "github"))],
    ["provider case", googleLocation(url => url.searchParams.set("provider", "Google"))],
    ["duplicate provider", googleLocation(url => url.searchParams.append("provider", "google"))],
    ["encoded duplicate provider", `${googleLocation()}&%70rovider=google`],
    ["missing callback", googleLocation(url => url.searchParams.delete("redirect_to"))],
    ["duplicate callback", googleLocation(url => url.searchParams.append("redirect_to", `${publicOrigin}/api/auth/callback`))],
    ["encoded duplicate callback", `${googleLocation()}&redirect%5fto=${encodeURIComponent(`${publicOrigin}/api/auth/callback`)}`],
    ...[`${upstreamOrigin}/api/auth/callback`, "https://outside.example/api/auth/callback", "/api/auth/callback",
      `${publicOrigin}/api/auth/callback/`, `${publicOrigin}/api/auth/callback?next=/account`, `${publicOrigin}/api/auth/callback#fragment`,
      `${publicOrigin}/flashloop/api/auth/callback`, `${publicOrigin}/api/auth/%63allback`,
    ].map(callback => [callback, googleLocation(url => url.searchParams.set("redirect_to", callback))]),
  ];
  for (const [label, location] of cases) {
    let calls = 0;
    const response = await handleStagingProxy(request("/api/auth/google"), googleSettings, async () => {
      calls++;
      return new Response("sensitive upstream body", { status: 303, headers: { Location: location } });
    });
    assert.equal(calls, 1, label);
    assert.equal(response.status, 502, label);
    assert.equal(response.headers.get("Location"), null, label);
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
