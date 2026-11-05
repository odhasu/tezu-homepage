import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest } from "node:http";

// No providers or credentials are used. This verifies the built Next.js network boundary.
const listener = createServer();
listener.listen(0, "127.0.0.1");
await once(listener, "listening");
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const proof = randomBytes(32).toString("hex");
const host = "edge-runtime.example.test";
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: new URL("..", import.meta.url),
  env: {
    PATH: process.env.PATH, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    VERCEL: "1", EDGE_PROTECTION_REQUIRED: "false", EDGE_ORIGIN_SECRET: proof, AUTH_ORIGIN: `https://${host}`,
    AUTH_ENABLED: "false", AUTH_PROVIDER_CONFIGURED: "false", NEXT_PUBLIC_AUTH_ENABLED: "false",
  },
  stdio: "ignore",
});
let checks = 0;
// Node 24 fetch ignores a custom Host header. Use HTTP so this test sends it on wire.
function request(path, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const call = httpRequest(base + path, { method, headers }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("error", reject);
      incoming.on("end", () => {
        const responseHeaders = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        }
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode, headers: responseHeaders }));
      });
    });
    call.setTimeout(5000, () => call.destroy(new Error("Runtime request timed out")));
    call.on("error", reject);
    call.end();
  });
}
async function check(path, headers, expected, method = "GET") {
  const response = await request(path, headers, method);
  assert.equal(response.status, expected, `${method} ${path}: unexpected status`);
  if (expected === 403 || expected === 503) {
    assert.equal(response.headers.get("cache-control"), "private, no-store", `${path}: rejection must not be cached`);
  }
  assert.equal((await response.text()).includes(proof), false, "Origin proof must never appear in response");
  for (const [name, value] of response.headers) {
    assert.equal(value.includes(proof), false, `Origin proof must never appear in response header ${name}`);
  }
  checks++;
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Runtime server exited before readiness");
    try {
      const response = await request("/blue");
      await response.arrayBuffer();
      ready = true;
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, "Runtime server did not become ready");
  const forged = { host, origin: `https://${host}`, "cf-connecting-ip": "203.0.113.8", "cf-ray": "forged", "x-forwarded-host": host };
  for (const path of ["/blue", "/api/auth/signup", "/api/auth/callback?code=not-a-code", "/api/checkout", "/api/account", "/api/projects", "/api/generations", "/api/whop/webhook", "/api/inngest", "/account", "/auth/signup", "/sites/flashloop/blue/hero-grid.svg", "/api/auth/%73ignup"]) {
    await check(path, forged, 403);
  }
  // Next.js canonicalization precedes Proxy, but the redirect grants no API access.
  const canonical = await request("/api/auth/signup/", forged);
  assert.equal(canonical.status, 308);
  assert.equal(canonical.headers.get("location"), "/api/auth/signup");
  await canonical.arrayBuffer();
  checks++;
  await check("/api/auth/signup", forged, 403);
  await check("/api/auth/signup", { ...forged, "x-flashloop-edge-key": "forged" }, 403, "POST");
  await check("/api/checkout", { ...forged, "x-flashloop-edge-key": proof, host: "kumi-staging.vercel.app" }, 403, "POST");
  const edge = { ...forged, "x-flashloop-edge-key": proof };
  await check("/blue", edge, 200);
  await check("/sites/flashloop/blue/hero-grid.svg", edge, 200);
  await check("/api/checkout", edge, 503, "POST");
  await check("/api/auth/signup", edge, 503, "POST");
  await check("/api/whop/webhook", edge, 404, "POST");
  console.log(`${checks} built Next.js origin-boundary checks passed. No live Cloudflare, Auth, account quota, or payment behavior was tested.`);
} finally {
  if (server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timer);
  }
}
