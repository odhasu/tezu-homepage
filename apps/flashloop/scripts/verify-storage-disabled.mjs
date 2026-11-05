import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Real production Next.js HTTP check with no provider credentials or service mocks.
// This checks disabled behavior only; it cannot prove configured R2 or hosted RLS.
const listener = createServer();
await new Promise((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: new URL("../", import.meta.url), stdio: "ignore",
  env: { PATH: process.env.PATH, NODE_ENV: "production", AUTH_ENABLED: "false", PRIVATE_STORAGE_ENABLED: "false", STORAGE_CLEANUP_ENABLED: "false", NEXT_TELEMETRY_DISABLED: "1" },
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error("Server exited");
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Wait for startup. */ }
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, "Production server must start");
  const project = "20000000-0000-4000-8000-000000000001";
  const object = "30000000-0000-4000-8000-000000000001";
  const paths = [
    `/api/projects/${project}/storage`,
    ...["complete", "download", "delete"].map((action) => `/api/projects/${project}/storage/${object}/${action}`),
    "/api/inngest",
  ];
  for (const path of paths) {
    const response = await fetch(`${origin}${path}`, { method: "POST", headers: { origin, "content-type": "application/json", "x-requested-with": "flashloop" }, body: "{}", signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 503, "Disabled endpoint must fail closed");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal("url" in body, false, "Disabled endpoint must not issue signed URLs");
  }
  console.log("PASS: 5 actual production Next.js HTTP endpoints fail closed with private, no-store and no signed URL.");
  console.log("Scope: disabled runtime only. Configured Auth/R2 access, signatures, and URL expiry remain unverified.");
} catch {
  console.error("FAIL: private storage disabled-runtime verification. Rebuild the normal runtime before retrying.");
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
