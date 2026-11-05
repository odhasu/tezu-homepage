import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Real local production HTTP; no hosted credentials, modeled account success, or CDN.
const listener = createServer();
await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: new URL("../", import.meta.url), stdio: "ignore",
  env: {
    PATH: process.env.PATH, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    AUTH_ENABLED: "false", PRIVATE_STORAGE_ENABLED: "false", STORAGE_CLEANUP_ENABLED: "false",
    GENERATION_JOBS_ENABLED: "false", GENERATION_WEBHOOKS_ENABLED: "false",
  },
});
let checked = 0;
const requestIds = new Set();
let activeCheck = "production server startup";
function ensurePrivate(response) {
  const policy = response.headers.get("cache-control") ?? "";
  assert.match(policy, /(?:^|,)\s*private(?:,|$)/);
  assert.match(policy, /(?:^|,)\s*no-store(?:,|$)/);
  assert.doesNotMatch(policy, /(?:^|,)\s*(?:public|s-maxage|immutable)(?:[=,]|$)/);
  for (const header of ["cdn-cache-control", "vercel-cdn-cache-control"]) assert.equal(response.headers.get(header), "no-store");
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error("Server exited");
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Startup only. */ }
    if (ready) break;
    await delay(200);
  }
  assert.ok(ready);
  const request = (path, options = {}) => fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(5000), ...options });
  const project = "20000000-0000-4000-8000-000000000001";
  const object = "30000000-0000-4000-8000-000000000001";
  for (const [method, path] of [
    ["GET", "/auth"], ["GET", "/auth/signup"], ["GET", "/auth/verify"], ["GET", "/auth/missing"],
    ["GET", "/account"], ["GET", "/account/missing"], ["GET", "/api/account"],
    ["GET", "/api/auth/session"], ["GET", "/api/auth/callback?code=public-synthetic-fixture"],
    ["POST", "/api/auth/signup"], ["GET", "/api/projects"], ["GET", `/api/projects/${project}/outputs`],
    ["POST", `/api/projects/${project}/storage/${object}/download`], ["POST", "/api/generations"],
    ["POST", "/api/webhooks/generation/unconfigured"], ["GET", "/api/inngest"],
    ["GET", "/api/unknown-future-route"], ["PATCH", "/api/auth/session"], ["OPTIONS", "/api/projects"],
    ["POST", "/api/analytics"],
  ]) {
    activeCheck = `${method} ${path.split("?")[0]}`;
    const response = await request(path, { method, headers: { "X-Request-ID": "untrusted-public-fixture" } });
    ensurePrivate(response);
    if (path.startsWith("/api/") && !["/api/inngest", "/api/analytics", "/api/unknown-future-route"].includes(path) && !["PATCH", "OPTIONS"].includes(method)) {
      const requestId = response.headers.get("x-request-id");
      assert.match(requestId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(requestIds.has(requestId), false);
      requestIds.add(requestId);
    }
    await response.arrayBuffer();
    checked++;
  }
  activeCheck = "two synthetic cookie jars at identical disabled account URL";
  // These are public fixture markers, not valid sessions. Live A/B account data
  // and browser/CDN caches require the separate staging acceptance exercise.
  for (const cookie of ["fixture-account=A", "fixture-account=B", "fixture-account=A", ""]) {
    const response = await request("/api/account", { headers: { Cookie: cookie } });
    ensurePrivate(response);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal("userId" in body, false);
    assert.equal("videoCredits" in body, false);
    checked++;
  }
  activeCheck = "public HTML and versioned framework assets";
  const page = await request("/blue");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("cache-control") ?? "", /s-maxage=[1-9]/);
  assert.equal(page.headers.get("set-cookie"), null);
  const html = await page.text();
  const asset = html.match(/(?:src|href)="([^\"]*\/_next\/static\/[^\"?]+\.(?:js|css))"/)?.[1];
  assert.ok(asset);
  const immutable = await request(asset);
  assert.equal(immutable.status, 200);
  assert.equal(immutable.headers.get("cache-control"), "public, max-age=31536000, immutable");
  await immutable.arrayBuffer();
  checked += 2;
  activeCheck = "mutable public assets revalidate";
  const imagePath = "/sites/flashloop/blue/hero-grid.svg";
  const mutable = await request(imagePath);
  assert.equal(mutable.status, 200);
  assert.equal(mutable.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.ok(mutable.headers.get("etag"));
  await mutable.arrayBuffer();
  // Undici has no persistent browser cache. Explicit mode stops Fetch from
  // adding request no-cache merely because this manual validator is present.
  const conditional = await request(imagePath, { cache: "force-cache", headers: { "If-None-Match": mutable.headers.get("etag") } });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  checked += 2;
  console.log(`PASS: ${checked} local production HTTP caching checks; private routes/errors, disabled synthetic jars, public HTML, hashed assets and conditional asset revalidation.`);
  console.log("Limits: no valid account sessions, real browser cache, deployed CDN, R2 signed URL, hosted Auth/RLS, or production security verification.");
} catch {
  console.error(`FAIL: HTTP caching check: ${activeCheck}. No request payloads, cookies, or server logs printed.`);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
