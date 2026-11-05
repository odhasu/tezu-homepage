import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServerClient } from "@supabase/ssr";

const authOrigin = "https://kumi-staging.vercel.app";
const appDirectory = fileURLToPath(new URL("../", import.meta.url));
const nextBinary = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));

function ensure(condition) {
  if (!condition) throw new Error("Route verification failed");
}

async function availablePort() {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  ensure(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function cookieHeader(identity, supabaseUrl, publishable) {
  const jar = new Map();
  const client = createServerClient(supabaseUrl, publishable, {
    cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => {
        for (const { name, value, options } of values) {
          if (options?.maxAge === 0) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });
  const result = await client.auth.setSession({
    access_token: identity.session.access_token,
    refresh_token: identity.session.refresh_token,
  });
  ensure(!result.error && result.data.user?.id === identity.id && jar.size > 0);
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function stopServer(server) {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), delay(5_000, undefined, { ref: false })]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await once(server, "exit");
  }
}

/**
 * Executes the built Next.js Route Handlers against live staging Supabase.
 * Cookie headers are installed programmatically; this does not test browser cookie
 * security, delivered email, or human CAPTCHA. No generation or webhook runs.
 */
export async function verifyOwnershipRoutes({ a, b, am, bm, supabaseUrl, publishable, secret, check, serviceRpc, signedSession, verify, rpc }) {
  const port = await availablePort();
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [nextBinary, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: appDirectory,
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
      TZ: "UTC",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
      STATIC_EXPORT: "false",
      NEXT_PUBLIC_BASE_PATH: "",
      AUTH_ENABLED: "true",
      AUTH_PROVIDER_CONFIGURED: "true",
      AUTH_ORIGIN: authOrigin,
      TURNSTILE_HOSTNAME: "kumi-staging.vercel.app",
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
      SUPABASE_SECRET_KEY: secret,
      // Protected data handlers never call CAPTCHA. This deliberately unused
      // fixture value satisfies configuration shape, not provider verification.
      TURNSTILE_SECRET: "ownership-route-fixture-unused-no-captcha-call",
    },
    // Never persist or print server logs: they may contain private request data.
    stdio: ["ignore", "ignore", "ignore"],
  });
  let launchFailed = false;
  server.once("error", () => { launchFailed = true; });
  let count = 0;
  const routeCheck = async (name, action) => {
    await check(`Route Handlers: ${name}`, action);
    count += 1;
  };

  try {
    await routeCheck("built server starts without exposing logs or credentials", async () => {
      const deadline = Date.now() + 30_000;
      let ready = false;
      while (Date.now() < deadline && !launchFailed && server.exitCode === null) {
        try {
          const response = await fetch(`${base}/api/projects`, { cache: "no-store", signal: AbortSignal.timeout(1_000) });
          ready = response.status === 401 && response.headers.get("cache-control") === "private, no-store";
          await response.arrayBuffer();
          if (ready) break;
        } catch { /* Wait only for the local process to become ready. */ }
        await delay(200);
      }
      ensure(ready);
    });
    const cookies = new Map([
      [a.id, await cookieHeader(a, supabaseUrl, publishable)],
      [b.id, await cookieHeader(b, supabaseUrl, publishable)],
    ]);
    async function request(identity, path, { method = "GET", body, origin = authOrigin, cookie, naturalCache = false, validator } = {}) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "flashloop",
          Origin: origin,
          "Sec-Fetch-Site": "same-origin",
          ...(validator ? { "If-None-Match": validator } : {}),
          ...(identity || cookie ? { Cookie: cookie ?? cookies.get(identity.id) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Cache acceptance must not send no-cache directives that mask an
        // intermediary mistake. Other ownership checks retain their old mode.
        // Undici does not retain responses. Explicit force-cache avoids its
        // automatic no-cache header on manually conditional requests.
        cache: naturalCache ? "force-cache" : "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      // Every supported success and rejection path must remain private.
      ensure(response.headers.get("cache-control") === "private, no-store");
      if (naturalCache) {
        ensure(response.headers.get("cdn-cache-control") === "no-store");
        ensure(response.headers.get("vercel-cdn-cache-control") === "no-store");
        ensure(!response.headers.get("age") || Number(response.headers.get("age")) === 0);
        ensure(!/^(HIT|STALE)$/i.test(response.headers.get("x-vercel-cache") ?? ""));
        ensure(!/^(HIT|STALE)$/i.test(response.headers.get("cf-cache-status") ?? ""));
      }
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* Fail closed below. */ }
      return { status: response.status, data: data?.data, body: data, etag: response.headers.get("etag") };
    }
    const status = (result, expected) => { ensure(result.status === expected); return result.data; };
    async function create(identity, path, body) {
      const data = status(await request(identity, path, { method: "POST", body }), 201);
      ensure(data && typeof data.id === "string");
      return data;
    }

    await routeCheck("no session cannot read protected account or project metadata", async () => {
      for (const path of ["/api/account", "/api/account/profile", "/api/projects", `/api/projects/${am.first.id}`, `/api/projects/${am.first.id}/jobs`]) {
        status(await request(null, path), 401);
      }
      status(await request(null, "/api/projects", { method: "POST", body: { name: "denied" } }), 401);
    });
    await routeCheck("each real fixture session can read only its account", async () => {
      for (const identity of [a, b]) {
        const profile = status(await request(identity, "/api/account/profile"), 200);
        ensure(profile.user_id === identity.id);
        const account = await request(identity, "/api/account");
        ensure(account.status === 200 && account.body.userId === identity.id && account.body.videoCredits === 0);
      }
    });
    await routeCheck("project lists contain only the current owner", async () => {
      for (const identity of [a, b]) {
        const data = status(await request(identity, "/api/projects"), 200);
        ensure(Array.isArray(data) && data.length > 0 && data.every((row) => row.owner_id === identity.id));
      }
    });
    const fixtures = [];
    await routeCheck("both owners create project, job, and upload metadata", async () => {
      for (const identity of [a, b]) {
        const project = await create(identity, "/api/projects", { name: "Route project" });
        ensure(project.owner_id === identity.id);
        const path = `/api/projects/${project.id}`;
        const job = await create(identity, `${path}/jobs`, { label: "Route job" });
        const upload = await create(identity, `${path}/uploads`, { filename: "route.png", content_type: "image/png", byte_size: 8 });
        ensure(job.owner_id === identity.id && job.project_id === project.id && job.status === "queued");
        ensure(upload.owner_id === identity.id && upload.project_id === project.id && upload.status === "pending");
        fixtures.push({ identity, project, job, upload });
      }
    });
    await routeCheck("both owners read and rename their project metadata", async () => {
      for (const { identity, project } of fixtures) {
        const path = `/api/projects/${project.id}`;
        ensure(status(await request(identity, path), 200).id === project.id);
        const updated = status(await request(identity, path, { method: "PATCH", body: { name: "Renamed route project" } }), 200);
        ensure(updated.id === project.id && updated.name === "Renamed route project");
      }
    });
    for (const resource of ["jobs", "uploads"]) {
      await routeCheck(`both owners list, read, and update their ${resource}`, async () => {
        for (const fixture of fixtures) {
          const { identity, project } = fixture;
          const record = resource === "jobs" ? fixture.job : fixture.upload;
          const collection = `/api/projects/${project.id}/${resource}`;
          const list = status(await request(identity, collection), 200);
          ensure(Array.isArray(list) && list.length === 1 && list[0].id === record.id);
          const path = `${collection}/${record.id}`;
          ensure(status(await request(identity, path), 200).id === record.id);
          const body = resource === "jobs" ? { label: "Renamed route job" } : { filename: "renamed-route.png" };
          const updated = status(await request(identity, path, { method: "PATCH", body }), 200);
          ensure(Object.entries(body).every(([key, value]) => updated[key] === value));
        }
      });
    }
    await routeCheck("workers create outputs and owners read and rename them", async () => {
      for (const fixture of fixtures) {
        const { identity, project, job } = fixture;
        const args = { p_job_id: job.id, p_project_id: project.id, p_owner_id: identity.id };
        ensure(await serviceRpc("advance_owned_job", { ...args, p_status: "running" }) === true);
        const id = await serviceRpc("record_owned_output", { ...args, p_filename: "route-output.png", p_content_type: "image/png", p_byte_size: 16 });
        ensure(typeof id === "string");
        fixture.output = { id };
        const collection = `/api/projects/${project.id}/outputs`;
        const outputs = status(await request(identity, collection), 200);
        ensure(outputs.length === 1 && outputs[0].id === id);
        ensure(status(await request(identity, `${collection}/${id}`), 200).job_id === job.id);
        const updated = status(await request(identity, `${collection}/${id}`, { method: "PATCH", body: { filename: "renamed-output.png" } }), 200);
        ensure(updated.filename === "renamed-output.png");
      }
    });
    await routeCheck("identical private URLs alternate two real sessions without client cache bypass", async () => {
      for (const [owner, foreign] of [[fixtures[0], fixtures[1]], [fixtures[1], fixtures[0]]]) {
        const ownPath = `/api/projects/${owner.project.id}`;
        const paths = [ownPath, `${ownPath}/jobs/${owner.job.id}`, `${ownPath}/uploads/${owner.upload.id}`, `${ownPath}/outputs/${owner.output.id}`];
        for (const path of paths) {
          const warm = await request(owner.identity, path, { naturalCache: true });
          ensure(warm.status === 200 && warm.data.owner_id === owner.identity.id);
          // A cached success/ETag must never answer another account's request.
          for (const identity of [foreign.identity, null, foreign.identity]) {
            const denied = await request(identity, path, {
              naturalCache: true, validator: warm.etag ?? '"public-synthetic-validator"',
            });
            ensure(denied.status === (identity ? 404 : 401) && !denied.data);
          }
          ensure((await request(owner.identity, path, { naturalCache: true })).data.owner_id === owner.identity.id);
        }
      }
      for (const path of ["/api/account", "/api/account/profile"]) {
        for (const identity of [a, b, a, b]) {
          const account = await request(identity, path, { naturalCache: true });
          ensure(account.status === 200);
          ensure(path === "/api/account" ? account.body.userId === identity.id : account.data.user_id === identity.id);
        }
        ensure((await request(null, path, { naturalCache: true })).status === 401);
      }
    });
    await routeCheck("cross-owner project GET, PATCH, and DELETE return 404 in both directions", async () => {
      for (const [attacker, foreign] of [[a, fixtures[1]], [b, fixtures[0]]]) {
        const path = `/api/projects/${foreign.project.id}`;
        status(await request(attacker, path), 404);
        status(await request(attacker, path, { method: "PATCH", body: { name: "forged" } }), 404);
        status(await request(attacker, path, { method: "DELETE" }), 404);
        ensure(status(await request(foreign.identity, path), 200).name === "Renamed route project");
      }
    });
    for (const resource of ["jobs", "uploads", "outputs"]) {
      await routeCheck(`${resource} require parent ownership for list, read, update, and delete`, async () => {
        for (const [attacker, foreign] of [[a, fixtures[1]], [b, fixtures[0]]]) {
          const record = resource === "jobs" ? foreign.job : resource === "uploads" ? foreign.upload : foreign.output;
          const collection = `/api/projects/${foreign.project.id}/${resource}`;
          const path = `${collection}/${record.id}`;
          status(await request(attacker, collection), 404);
          status(await request(attacker, path), 404);
          status(await request(attacker, path, { method: "PATCH", body: resource === "jobs" ? { label: "forged" } : { filename: "forged.png" } }), 404);
          status(await request(attacker, path, { method: "DELETE" }), 404);
          status(await request(foreign.identity, path), 200);
        }
      });
    }
    await routeCheck("cross-owner child creation returns 404", async () => {
      const parent = fixtures[1].project.id;
      status(await request(a, `/api/projects/${parent}/jobs`, { method: "POST", body: { label: "forged" } }), 404);
      status(await request(a, `/api/projects/${parent}/uploads`, { method: "POST", body: { filename: "forged.png", content_type: "image/png", byte_size: 1 } }), 404);
    });
    await routeCheck("same-owner child IDs cannot escape their project route", async () => {
      const parent = fixtures[0].project.id;
      for (const [resource, record] of [["jobs", am.job], ["uploads", am.upload], ["outputs", am.output]]) {
        const path = `/api/projects/${parent}/${resource}/${record.id}`;
        status(await request(a, path), 404);
        status(await request(a, path, { method: "PATCH", body: resource === "jobs" ? { label: "forged" } : { filename: "forged.png" } }), 404);
        status(await request(a, path, { method: "DELETE" }), 404);
      }
    });
    await routeCheck("forged owner, parent, state, key, and job fields return 400", async () => {
      const { project, job, upload, output } = fixtures[0];
      for (const [path, method, body] of [
        ["/api/projects", "POST", { name: "forged", owner_id: b.id }],
        [`/api/projects/${project.id}`, "PATCH", { name: "forged", owner_id: b.id }],
        ["/api/account/profile", "PATCH", { display_name: "forged", user_id: b.id }],
        [`/api/projects/${project.id}/jobs`, "POST", { label: "forged", project_id: bm.first.id }],
        [`/api/projects/${project.id}/jobs/${job.id}`, "PATCH", { label: "forged", status: "succeeded" }],
        [`/api/projects/${project.id}/uploads/${upload.id}`, "PATCH", { filename: "forged.png", object_key: bm.upload.object_key }],
        [`/api/projects/${project.id}/outputs/${output.id}`, "PATCH", { filename: "forged.png", job_id: bm.job.id }],
      ]) status(await request(a, path, { method, body }), 400);
    });
    await routeCheck("output creation stays unavailable to user routes", async () => {
      status(await request(a, `/api/projects/${fixtures[0].project.id}/outputs`, {
        method: "POST", body: { filename: "forged.png", content_type: "image/png", byte_size: 1 },
      }), 405);
    });
    await routeCheck("cross-origin mutations are rejected without changes", async () => {
      const path = `/api/projects/${fixtures[0].project.id}`;
      status(await request(a, path, { method: "PATCH", body: { name: "forged" }, origin: "https://attacker.invalid" }), 403);
      ensure(status(await request(a, path), 200).name === "Renamed route project");
    });
    await routeCheck("a fresh pending session cannot access protected handlers", async () => {
      const pending = await signedSession(a);
      const cookie = await cookieHeader(pending, supabaseUrl, publishable);
      for (const path of ["/api/account/profile", "/api/projects", `/api/projects/${fixtures[0].project.id}/jobs`]) {
        status(await request(pending, path, { cookie }), 403);
      }
      status(await request(pending, "/api/projects", { method: "POST", cookie, body: { name: "pending" } }), 403);
    });
    await routeCheck("revocation immediately denies an existing signed session cookie", async () => {
      const revocable = await signedSession(a);
      await verify(revocable);
      const cookie = await cookieHeader(revocable, supabaseUrl, publishable);
      status(await request(revocable, "/api/projects", { cookie, naturalCache: true }), 200);
      const revoked = await rpc(revocable, "revoke_current_session", {});
      ensure(revoked.ok && revoked.data === true);
      status(await request(revocable, "/api/projects", { cookie, naturalCache: true }), 403);
      status(await request(revocable, "/api/projects", { method: "POST", cookie, body: { name: "revoked" } }), 403);
      status(await request(a, "/api/projects"), 200);
    });
    await routeCheck("owners update, delete, and recreate only their profile", async () => {
      for (const identity of [a, b]) {
        const patched = status(await request(identity, "/api/account/profile", { method: "PATCH", body: { display_name: "Route profile" } }), 200);
        ensure(patched.user_id === identity.id && patched.display_name === "Route profile");
        ensure(status(await request(identity, "/api/account/profile", { method: "DELETE" }), 200).user_id === identity.id);
        const created = status(await request(identity, "/api/account/profile", { method: "POST", body: { display_name: "Restored route profile" } }), 201);
        ensure(created.user_id === identity.id && created.display_name === "Restored route profile");
      }
    });
    await routeCheck("both owners delete their output, upload, job, and project metadata", async () => {
      for (const fixture of fixtures) {
        const { identity, project, job, upload, output } = fixture;
        for (const [resource, record] of [["outputs", output], ["uploads", upload], ["jobs", job]]) {
          const path = `/api/projects/${project.id}/${resource}/${record.id}`;
          ensure(status(await request(identity, path, { method: "DELETE" }), 200).id === record.id);
          status(await request(identity, path), 404);
        }
        const path = `/api/projects/${project.id}`;
        ensure(status(await request(identity, path, { method: "DELETE" }), 200).id === project.id);
        status(await request(identity, path), 404);
      }
    });
    return count;
  } finally {
    await stopServer(server);
  }
}
