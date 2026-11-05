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

  await reset(admin, { credits: 0 });
  const zeroRace = await concurrent(20, (client, index) => reserve(client, actors[0], `zero-credit-key-${index.toString().padStart(4,"0")}`, index % 2 === 1));
  check(successes(zeroRace).length === 0, "Zero-credit accounts must never reserve a paid video");
  check(rejections(zeroRace,"insufficient video credits").length === 20, "All zero-credit requests must be denied");
  check((await ledger(admin)).reservations === 0, "Zero-credit denial must leave no reservation");

  await reset(admin, { accountCap: 300 });
  const accountRace = await concurrent(20, (client, index) => reserve(client, actors[0], `account-race-key-${index.toString().padStart(4, "0")}`, index % 2 === 1));
  check(successes(accountRace).length === 3, "Twenty mixed website/worker requests must stop at account ceiling");
  check(rejections(accountRace, "account daily spend cap").length === 17, "Seventeen requests must be denied by account ceiling");
  check((await ledger(admin)).global_spend === 300, "Account race must reserve exactly 300 micros");
  check((await admin.query("select credits from public.video_credit_accounts where user_id=$1", [actors[0].userId])).rows[0].credits === "970", "Account race debits exactly three credit charges");

  await reset(admin, { globalCap: 300 });
  const globalRace = await concurrent(20, (client, index) => reserve(client, actors[index % 2], `global-race-key-${index.toString().padStart(4, "0")}`, index % 2 === 1));
  check(successes(globalRace).length === 3, "Twenty requests across two accounts must stop at global ceiling");
  check(rejections(globalRace, "global daily spend cap").length === 17, "Seventeen requests must be denied by global ceiling");
  check((await ledger(admin)).global_spend === 300, "Global race must reserve exactly 300 micros");

  await reset(admin, { globalCap: 300 });
  await reserve(admin,actors[0],"committed-spend-key-0001");
  await service(admin);
  await admin.query("select public.claim_generation($1,$2)",[actors[0].userId,"committed-spend-key-0001"]);
  await admin.query("select public.resolve_generation($1,$2,80)",[actors[0].userId,"committed-spend-key-0001"]);
  const committedRace = await concurrent(20,(client,index) => reserve(client,actors[index % 2],`committed-race-key-${index.toString().padStart(4,"0")}`,index % 2 === 1));
  check(successes(committedRace).length === 2,"Committed actual cost plus new in-flight spend must stop at global cap");
  check(rejections(committedRace,"global daily spend cap").length === 18,"Eighteen requests must be denied after existing committed spend");
  check((await ledger(admin)).global_spend === 280,"Ledger must contain 80 committed plus 200 in-flight micros");

  await reset(admin, { activeLimit: 2 });
  const activeRace = await concurrent(20, (client, index) => reserve(client, actors[0], `active-race-key-${index.toString().padStart(4, "0")}`, index % 2 === 1));
  check(successes(activeRace).length === 2, "Concurrent reservations must stop at active job limit");
  check(rejections(activeRace, "concurrent job limit").length === 18, "Eighteen requests must be denied by active job limit");
  check((await ledger(admin)).active_jobs === 2, "Active job count must equal successful reservations");

  await reset(admin);
  const replayRace = await concurrent(20, (client, index) => reserve(client, actors[0], "same-request-key-0001", index % 2 === 1));
  check(successes(replayRace).length === 20, "All same-key retries must return their durable reservation");
  check(new Set(successes(replayRace).map((result) => result.value.reservationId)).size === 1, "All same-key retries must share one reservation ID");
  check((await ledger(admin)).reservations === 1, "Same-key race must insert one reservation");
  check((await ledger(admin)).global_spend === 100, "Same-key race must reserve cost once");

  const claimRace = await concurrent(20, async (client) => {
    await service(client);
    return (await client.query("select public.claim_generation($1,$2) as reservation", [actors[0].userId,"same-request-key-0001"])).rows[0].reservation;
  });
  check(successes(claimRace).length === 20, "All claim retries must return durable claim state");
  check(successes(claimRace).filter((result) => result.value.dispatchAllowed === true).length === 1, "Exactly one concurrent worker may dispatch provider request");
  check(successes(claimRace).every((result) => result.value.status === "dispatching"), "Dispatch state must commit before provider I/O");
  check(new Set(successes(claimRace).map((result) => result.value.providerIdempotencyKey)).size === 1, "All workers must retain same stable provider idempotency key");
  await service(admin);
  await admin.query("select public.mark_generation_unknown($1,$2)", [actors[0].userId,"same-request-key-0001"]);
  const unknownClaims = await concurrent(20, async (client) => {
    await service(client);
    return (await client.query("select public.claim_generation($1,$2) as reservation", [actors[0].userId,"same-request-key-0001"])).rows[0].reservation;
  });
  check(successes(unknownClaims).every((result) => result.value.dispatchAllowed === false && result.value.status === "unknown"), "Unknown provider timeouts must never grant another dispatch");
  await assert.rejects(admin.query("select public.release_generation($1,$2)", [actors[0].userId,"same-request-key-0001"]), (error) => error.code === "55000");
  assertions += 1;
  check((await ledger(admin)).global_spend === 100 && (await ledger(admin)).active_jobs === 1, "Unknown outcome must retain full spend and active-job reservation");
  check((await admin.query("select credits from public.video_credit_accounts where user_id=$1",[actors[0].userId])).rows[0].credits === "990", "Unknown outcome must retain consumed credits");

  // A prior-day unknown reservation still counts toward today's limit.
  await admin.query("update private.generation_reservations set spend_day=(clock_timestamp() at time zone 'UTC')::date-1 where status='unknown'");
  await admin.query("update private.generation_global_days set spend_day=(clock_timestamp() at time zone 'UTC')::date-1");
  await admin.query("update private.generation_account_days set spend_day=(clock_timestamp() at time zone 'UTC')::date-1");
  await service(admin);
  await admin.query("select public.configure_generation_policy(true,'USD',100,10000,100,'UTC')");
  const rollover = await concurrent(10, (client,index) => reserve(client, actors[1], `rollover-test-key-${index.toString().padStart(4,"0")}`, index % 2 === 1));
  check(successes(rollover).length === 0, "Prior-day unknown exposure must block today's global ceiling");
  check(rejections(rollover,"global daily spend cap").length === 10, "All rollover overspend requests must be denied");

  // Cancellation and claim share the same PostgreSQL mutex. Either cancellation
  // wins and no worker can send, or a claim wins and no refund can occur.
  await reset(admin);
  await reserve(admin,actors[0],"cancel-claim-race-0001");
  const cancelRace = await concurrent(20, async (client,index) => {
    await service(client);
    const operation = index % 2 === 0 ? "claim_generation" : "release_generation";
    return (await client.query(`select public.${operation}($1,$2) as reservation`,[actors[0].userId,"cancel-claim-race-0001"])).rows[0].reservation;
  });
  await admin.query("reset role");
  const state = (await admin.query("select r.status,a.credits,r.held_cost_micros from private.generation_reservations r join public.video_credit_accounts a on a.user_id=r.user_id")).rows[0];
  if (state.status === "released") {
    check(successes(cancelRace).every((result) => result.value.dispatchAllowed !== true), "Cancelled request cannot grant dispatch");
    check(state.credits === "1000" && state.held_cost_micros === "0", "Cancellation winner refunds exactly once");
    check(cancelRace.every((result) => result.ok),"Cancelled request claim/release retries return durable released state");
    check((await ledger(admin)).active_jobs === 0,"Cancellation winner frees exactly one active slot");
  } else {
    check(state.status === "dispatching", "Claim winner must remain dispatching");
    check(successes(cancelRace).filter((result) => result.value.dispatchAllowed === true).length === 1, "Claim/cancel race grants exactly one dispatch");
    check(state.credits === "990" && state.held_cost_micros === "100", "Claim winner must retain funds");
    check(cancelRace.filter((result) => !result.ok).every((result) => result.code === "55000"), "Only release-after-claim denials allowed");
  }

  console.log(`PASS: native PostgreSQL ${version}; ${migrations.length} actual migrations; ${assertions} assertions with independent connections.`);
  console.log("Scope: disposable native PostgreSQL, not hosted Supabase Auth, provider billing, or production security.");
} catch (error) {
  console.error("Generation concurrency regression failed:", error instanceof Error ? error.message : String(error));
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
