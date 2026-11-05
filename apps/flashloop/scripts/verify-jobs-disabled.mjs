import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

// Real HTTP against a production build. This proves disabled behavior only.
let checked = 0;
for (const enabled of [false, true]) {
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
      GENERATION_JOBS_ENABLED: String(enabled), GENERATION_WEBHOOKS_ENABLED: String(enabled),
      // Deliberately public fixture values. No external API or database credentials.
      INNGEST_SIGNING_KEY: "signkey-test-" + "01".repeat(32), INNGEST_EVENT_KEY: "test-event-fixture",
    },
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
    for (const [method, path] of [["GET", "/api/inngest"], ["POST", "/api/inngest"], ["PUT", "/api/inngest"], ["POST", "/api/webhooks/generation/unconfigured"]]) {
      const response = await fetch(`${origin}${path}`, { method, headers: { "content-type": "application/json" },
        ...(method === "GET" ? {} : { body: "{}" }), signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const data = await response.json();
      assert.equal(typeof data.error, "string");
      assert.equal("reservation" in data, false);
      checked++;
    }
  } catch {
    console.error("FAIL: generation disabled-runtime check. Rebuild normal runtime before retrying.");
    process.exitCode = 1;
  } finally {
    child.kill("SIGTERM");
    if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}
if (!process.exitCode) {
  console.log(`PASS: ${checked} real production Next.js HTTP checks fail closed with private, no-store, including enabled flags without an installed provider.`);
  console.log("Limits: disabled/configuration gates only; no hosted Auth, provider signing/billing, Inngest Cloud, or production security verification.");
}
