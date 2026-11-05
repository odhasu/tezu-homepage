import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Optional module root supports a separate temporary dependency installation.
// This runner never reads hosted credentials and starts only its own cluster.
const moduleRoot = process.env.FLASHLOOP_CONCURRENCY_MODULE_ROOT ?? fileURLToPath(new URL("./", import.meta.url));
assert.ok(moduleRoot?.startsWith("/"), "Set FLASHLOOP_CONCURRENCY_MODULE_ROOT to an absolute temporary dependency directory.");
const dependency = (path) => pathToFileURL(join(moduleRoot, "node_modules", path)).href;
const { default: getBinaries } = await import(dependency("embedded-postgres/dist/binary.js"));
const { ensureSymlinks } = await import(dependency("embedded-postgres/dist/symlinks.js"));
const { default: postgresDriver } = await import(dependency("pg/lib/index.js"));
const { Client } = postgresDriver;
const { postgres, initdb } = await getBinaries();
await ensureSymlinks(postgres, false);
await Promise.all([chmod(postgres, 0o755), chmod(initdb, 0o755)]);

const clusterRoot = await mkdtemp(join(tmpdir(), "flashloop-postgres-"));
const dataDirectory = join(clusterRoot, "data");
const databaseRoot = new URL("../", import.meta.url);
const connections = new Set();
let server;
let assertions = 0;

const actors = [
  { userId: "10000000-0000-4000-8000-000000000010", sessionId: "20000000-0000-4000-8000-000000000010", projectId: "30000000-0000-4000-8000-000000000010" },
  { userId: "10000000-0000-4000-8000-000000000011", sessionId: "20000000-0000-4000-8000-000000000011", projectId: "30000000-0000-4000-8000-000000000011" },
  { userId: "10000000-0000-4000-8000-000000000012", sessionId: "20000000-0000-4000-8000-000000000012", projectId: "30000000-0000-4000-8000-000000000012" },
];

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

async function freePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function runBinary(binary, args) {
  const child = spawn(binary, args, { env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
  let diagnostics = "";
  child.stdout.on("data", (data) => { diagnostics = (diagnostics + data.toString()).slice(-4000); });
  child.stderr.on("data", (data) => { diagnostics = (diagnostics + data.toString()).slice(-4000); });
  const [code] = await once(child, "close");
  assert.equal(code, 0, `Disposable PostgreSQL initialization failed: ${diagnostics}`);
}

const port = await freePort();
const connection = { host: "127.0.0.1", port, user: "postgres", database: "postgres", connectionTimeoutMillis: 5000 };

async function connect() {
  const client = new Client(connection);
  connections.add(client);
  await client.connect();
  await client.query("set statement_timeout = '20s'; set lock_timeout = '15s';");
  return client;
}

async function close(client) {
  connections.delete(client);
  await client.end();
}

async function concurrent(count, operation) {
  const clients = await Promise.all(Array.from({ length: count }, () => connect()));
  try {
    return await Promise.all(clients.map((client, index) => operation(client, index)
      .then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, message: error.message }))));
  } finally {
    await Promise.all(clients.map(close));
  }
}

async function service(client) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)");
  await client.query("set role service_role");
}

async function authenticated(client, actor) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "authenticated", sub: actor.userId, session_id: actor.sessionId })]);
  await client.query("set role authenticated");
}

async function seed(admin) {
  for (const [index, actor] of actors.entries()) {
    await admin.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [actor.userId, `concurrency-${index}@example.test`]);
    await admin.query("insert into auth.sessions (id, user_id) values ($1, $2)", [actor.sessionId, actor.userId]);
    await admin.query("insert into private.session_verifications(session_id, user_id, state, verified_at) values ($1, $2, 'verified', now())", [actor.sessionId, actor.userId]);
    await admin.query("insert into public.projects(id, owner_id, name) values ($1, $2, 'Concurrency fixture')", [actor.projectId, actor.userId]);
  }
}

async function reset(admin, { globalCap = 10000, accountCap = 10000, activeLimit = 100, credits = 1000 } = {}) {
  await admin.query("reset role");
  await admin.query("truncate private.generation_reservations, private.generation_requests, private.generation_global_days, private.generation_account_days, private.generation_active_jobs cascade");
  await admin.query("update public.video_credit_accounts set credits = $1", [credits]);
  await service(admin);
  await admin.query("select public.configure_generation_policy(true, 'USD', $1, $2, $3, 'UTC')", [globalCap, accountCap, activeLimit]);
  for (const actor of actors) await admin.query("select public.configure_generation_account($1,true,null,null)", [actor.userId]);
  await admin.query("select public.upsert_generation_price('video.concurrent',10,100,'{\"provider\":\"fixture\",\"model\":\"bounded\"}'::jsonb,true)");
  await admin.query("reset role");
}

async function reserve(client, actor, key, worker = false) {
  if (worker) await service(client);
  else await authenticated(client, actor);
  const result = worker
    ? await client.query("select public.reserve_generation_for_user($1,$2,$3,$4,$5,$6,$7) as reservation",
      [actor.userId, actor.sessionId, actor.projectId, key, "video.concurrent", "Concurrency fixture prompt", "Concurrency fixture"])
    : await client.query("select public.reserve_generation($1,$2,$3,$4,$5) as reservation",
      [actor.projectId, key, "video.concurrent", "Concurrency fixture prompt", "Concurrency fixture"]);
  return result.rows[0].reservation;
}

function successes(results) {
  return results.filter((result) => result.ok);
}

function rejections(results, expected) {
  const denied = results.filter((result) => !result.ok);
  check(denied.every((result) => result.code === "P0001" && result.message.toLowerCase().includes(expected)), `Only expected ${expected} denials are allowed`);
  return denied;
}

async function ledger(admin) {
  await admin.query("reset role");
  return (await admin.query(`select
    (select count(*)::int from private.generation_reservations) as reservations,
    (select coalesce(sum(reserved_micros + committed_micros),0)::int from private.generation_global_days) as global_spend,
    (select coalesce(sum(active_jobs),0)::int from private.generation_active_jobs) as active_jobs`)).rows[0];
}

try {
  // No password is generated or persisted: disposable trust-auth server binds
  // to 127.0.0.1 and its Unix socket lives in the private temporary directory.
  await runBinary(initdb, ["-D", dataDirectory, "--auth=trust", "--username=postgres", "--locale=C", "--encoding=UTF8"]);
  server = spawn(postgres, ["-D", dataDirectory, "-p", String(port), "-h", "127.0.0.1",
    "-k", clusterRoot, "-c", "unix_socket_permissions=0700", "-c", "log_statement=none"],
  { env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" }, stdio: ["ignore", "ignore", "pipe"] });
  await new Promise((ready, reject) => {
    let diagnostics = "";
    const timeout = setTimeout(() => reject(new Error("Disposable PostgreSQL startup timed out")), 15000);
    server.stderr.on("data", (data) => {
      diagnostics = (diagnostics + data.toString()).slice(-4000);
      if (diagnostics.includes("database system is ready to accept connections")) { clearTimeout(timeout); ready(); }
    });
    server.once("error", (error) => { clearTimeout(timeout); reject(error); });
    server.once("exit", () => { clearTimeout(timeout); reject(new Error(`Disposable PostgreSQL exited before ready: ${diagnostics}`)); });
  });
  const admin = await connect();
  const version = (await admin.query("show server_version")).rows[0].server_version;
  check(version.startsWith("17.11"), "Pinned native PostgreSQL 17.11 must run");
  check((await admin.query("show listen_addresses")).rows[0].listen_addresses === "127.0.0.1", "Test server must bind only loopback");
  await admin.query(await readFile(new URL("tests/auth-fixture.sql", databaseRoot), "utf8"));
  const migrations = (await readdir(new URL("migrations/", databaseRoot))).filter((file) => file.endsWith(".sql") && !file.endsWith("_whop_subscription_billing.sql")).sort();
  for (const migration of migrations) await admin.query(await readFile(new URL(`migrations/${migration}`, databaseRoot), "utf8"));
  await seed(admin);

  await reset(admin);
  await reserve(admin,actors[0],"lower-limit-key-0001");
  await reserve(admin,actors[0],"lower-limit-key-0002");
  await service(admin);
  await admin.query("select public.configure_generation_policy(true,'USD',10000,10000,1,'UTC')");
  const tightened = await concurrent(20,async (client,index) => {
    await service(client);
    return client.query("select public.claim_generation($1,$2)",[actors[0].userId,index%2 ? "lower-limit-key-0001" : "lower-limit-key-0002"]);
  });
  check(tightened.every((result) => !result.ok && result.code === "P0001" && result.message.includes("concurrent job limit")),"Execution rechecks tightened global concurrency limit before any paid dispatch");
  check((await ledger(admin)).active_jobs === 2 && (await ledger(admin)).global_spend === 200,"Execution quota denials retain existing reservations without refunds");
  await service(admin);
  await admin.query("select public.release_generation($1,$2)",[actors[0].userId,"lower-limit-key-0002"]);
  const allowed = await concurrent(20,async (client) => {
    await service(client);
    return (await client.query("select public.claim_generation($1,$2) as value",[actors[0].userId,"lower-limit-key-0001"])).rows[0].value;
  });
  check(successes(allowed).length === 20 && successes(allowed).filter((result) => result.value.dispatchAllowed).length === 1,"One retained slot permits exactly one execution after explicit unclaimed release");
  await reset(admin);
  await reserve(admin,actors[0],"account-limit-key-001");
  await reserve(admin,actors[0],"account-limit-key-002");
  await service(admin);
  await admin.query("select public.configure_generation_account($1,true,null,1)",[actors[0].userId]);
  const accountTightened = await concurrent(10,async (client) => {
    await service(client);
    return client.query("select public.claim_generation($1,$2)",[actors[0].userId,"account-limit-key-001"]);
  });
  check(accountTightened.every((result) => !result.ok && result.code === "P0001" && result.message.includes("concurrent job limit")),"Execution independently rechecks tightened account concurrency limit");
  await reset(admin);
  const reservation = await reserve(admin,actors[0],"callback-race-key-0001");
  await service(admin);
  await admin.query("select public.mark_generation_dispatched($1,$2,$3)",[actors[0].userId,"callback-race-key-0001","fixture-unclaimed"]).then(
    () => { throw new Error("Unclaimed job unexpectedly bound"); },
    (error) => check(error.code === "55000","Unclaimed job cannot obtain a provider binding"));
  const claimRace = await concurrent(20, async (client) => {
    await service(client);
    return (await client.query("select public.claim_generation($1,$2) as value",[actors[0].userId,"callback-race-key-0001"])).rows[0].value;
  });
  check(successes(claimRace).length === 20,"Restarted worker claims all read durable state");
  check(successes(claimRace).filter((result) => result.value.dispatchAllowed).length === 1,"Exactly one restarted worker can start paid operation");
  await service(admin);
  await admin.query("select public.mark_generation_dispatched($1,$2,$3)",[actors[0].userId,"callback-race-key-0001","fixture-race-1"]);
  const callbackRace = await concurrent(20, async (client) => {
    await service(client);
    return (await client.query("select public.apply_generation_callback($1,$2,$3,$4,$5,$6) as value",
      ["fixture","same-event-id","fixture-race-1","succeeded",60,"a".repeat(64)])).rows[0].value;
  });
  check(successes(callbackRace).length === 20,"Concurrent duplicate callbacks all return harmless acknowledgments");
  check(successes(callbackRace).filter((result) => result.value.applied).length === 1,"Concurrent duplicate callbacks apply exactly one transition");
  check(successes(callbackRace).filter((result) => result.value.duplicate).length === 19,"Nineteen replays recognized by durable event identity");
  check((await ledger(admin)).global_spend === 60,"Concurrent callback settlement books exactly 60 micros");
  check((await ledger(admin)).active_jobs === 0,"Concurrent callback settlement frees exactly one active slot");
  await admin.query("reset role");
  check((await admin.query("select count(*)::int as count from private.provider_callback_events")).rows[0].count === 1,"Duplicate callbacks persist one inbox row");
  check((await admin.query("select status from public.jobs where id=$1",[reservation.jobId])).rows[0].status === "succeeded","Owned job records one successful terminal state");
  check((await admin.query("select credits from public.video_credit_accounts where user_id=$1",[actors[0].userId])).rows[0].credits === "990","Callback races never double debit credits");
  const lateRace = await concurrent(20, async (client,index) => {
    await service(client);
    return (await client.query("select public.apply_generation_callback($1,$2,$3,$4,$5,$6) as value",
      ["fixture",`late-event-${index}`,"fixture-race-1",index%2 ? "running" : "failed",index%2 ? null : 90,"b".repeat(64)])).rows[0].value;
  });
  check(successes(lateRace).length === 20,"Late progress and conflicting final callbacks all acknowledged");
  check(successes(lateRace).every((result) => !result.value.applied && result.value.status === "committed"),"Late callbacks never reopen or resettle terminal jobs");
  check((await ledger(admin)).global_spend === 60,"Late callback race leaves spend unchanged");
  const changedRace = await concurrent(10, async (client) => {
    await service(client);
    return client.query("select public.apply_generation_callback($1,$2,$3,$4,$5,$6)",
      ["fixture","same-event-id","fixture-race-1","succeeded",60,"c".repeat(64)]);
  });
  check(changedRace.every((result) => !result.ok && result.code === "23505"),"Changed replay payload always conflicts under race");
  const unknownRace = await concurrent(10, async (client,index) => {
    await service(client);
    return client.query("select public.apply_generation_callback($1,$2,$3,$4,$5,$6)",
      ["fixture",`unknown-event-${index}`,"untracked-provider-job","succeeded",60,"d".repeat(64)]);
  });
  check(unknownRace.every((result) => !result.ok && result.code === "P0002"),"Unknown provider jobs never settle under race");
  await admin.query("reset role");
  check((await admin.query("select count(*)::int as count from private.provider_callback_events")).rows[0].count === 21,"Rejected changed or unknown callbacks leave no inbox mutation");
  check((await ledger(admin)).global_spend === 60 && (await ledger(admin)).active_jobs === 0,"Rejected callback races cannot change spend or active slots");

  // Publish acknowledgment and request replay race independently. The outbox
  // remains durable until accepted delivery is explicitly acknowledged.
  const pending = await reserve(admin,actors[0],"callback-outbox-key-0001");
  const outboxRace = await concurrent(20, async (client) => {
    await service(client);
    return (await client.query("select public.generation_dispatch_batch(100) as value")).rows[0].value;
  });
  check(successes(outboxRace).every((result) => result.value.length === 1 && result.value[0].requestId === pending.requestId),"Concurrent publishers see the same stable durable request");
  const ackRace = await concurrent(20, async (client) => {
    await service(client);
    return (await client.query("select public.generation_dispatch_sent($1) as value",[pending.requestId])).rows[0].value;
  });
  check(successes(ackRace).length === 20 && successes(ackRace).every((result) => result.value),"Concurrent delivery acknowledgments are idempotent");
  await service(admin);
  check((await admin.query("select public.generation_dispatch_batch(100) as value")).rows[0].value.length === 0,"Acknowledged outbox is no longer published");

  // More than one batch must make progress even while previously delivered
  // requests remain pending. NULL delivery timestamps sort before old retries.
  for (let index=0; index<55; index++) await reserve(admin,actors[0],`fair-outbox-key-${String(index).padStart(4,"0")}`);
  await service(admin);
  const firstBatch = (await admin.query("select public.generation_dispatch_batch(50) as value")).rows[0].value;
  check(firstBatch.length === 50,"Outbox enforces bounded batches with more than fifty pending requests");
  for (const row of firstBatch) await admin.query("select public.generation_dispatch_sent($1)",[row.requestId]);
  const secondBatch = (await admin.query("select public.generation_dispatch_batch(50) as value")).rows[0].value;
  check(secondBatch.length === 5,"Acknowledged first batch cannot starve later requests");
  check(secondBatch.every((row) => !firstBatch.some((first) => first.requestId === row.requestId)),"Fresh pending requests precede delivered retry work");
  await admin.query("reset role");
  await admin.query("update private.job_dispatch_outbox set delivered_at=clock_timestamp()-interval '6 minutes' where request_id=$1",[firstBatch[0].requestId]);
  await service(admin);
  const redrive = (await admin.query("select public.generation_dispatch_batch(6) as value")).rows[0].value;
  check(redrive.length === 6 && redrive[5].requestId === firstBatch[0].requestId,"Old delivered reservation redrives after all never-delivered requests");

  console.log(`PASS: native PostgreSQL ${version}; ${migrations.length} actual migrations; ${assertions} assertions with independent connections.`);
  console.log("Scope: real concurrent local PostgreSQL transactions; no hosted Supabase Auth, provider signature/idempotency/billing, Inngest transport, or production security claim.");
} catch (error) {
  console.error("Job concurrency regression failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([...connections].map(close));
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGINT");
    await stopped;
  }
  await rm(clusterRoot, { recursive: true, force: true });
}
