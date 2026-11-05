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

const clusterRoot = await mkdtemp(join(tmpdir(), "flashloop-storage-postgres-"));
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
    await admin.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [actor.userId, `storage-concurrency-${index}@example.test`]);
    await admin.query("insert into auth.sessions (id, user_id) values ($1, $2)", [actor.sessionId, actor.userId]);
    await admin.query("insert into private.session_verifications(session_id, user_id, state, verified_at) values ($1, $2, 'verified', now())", [actor.sessionId, actor.userId]);
    await admin.query("insert into public.projects(id, owner_id, name) values ($1, $2, 'Concurrency fixture')", [actor.projectId, actor.userId]);
  }
}

async function reserve(client, actor, bytes = 300, output = false) {
  if (output) {
    await service(client);
    return (await client.query("select public.storage_reserve_output($1,$2,$3,'concurrent.png','image/png',$4) as reservation",
      [actor.jobId, actor.projectId, actor.userId, bytes])).rows[0].reservation;
  }
  await authenticated(client, actor);
  return (await client.query("select public.reserve_project_upload($1,'concurrent.png','image/png',$2) as reservation",
    [actor.projectId, bytes])).rows[0].reservation;
}

async function chargedBytes(admin, ownerId) {
  await admin.query("reset role");
  return Number((await admin.query(`select
    coalesce((select sum(byte_size * 2) from public.project_objects where owner_id=$1),0)
    + coalesce((select sum(byte_size) from private.storage_cleanup where owner_id=$1),0) as bytes`, [ownerId])).rows[0].bytes);
}

async function waitForBlocked(admin, client) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await admin.query("select cardinality(pg_blocking_pids($1)) > 0 as blocked", [client.processID]);
    if (result.rows[0].blocked) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.fail("Competing operation must wait on the held PostgreSQL lock");
}

try {
  // Dedicated loopback cluster, no hosted credentials or inherited service env.
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
  for (const [index, actor] of actors.entries()) {
    actor.jobId = `40000000-0000-4000-8000-00000000001${index}`;
    await admin.query("insert into public.jobs(id,project_id,owner_id,status,label) values($1,$2,$3,'running','Storage concurrency fixture')", [actor.jobId, actor.projectId, actor.userId]);
  }
  await service(admin);
  await admin.query("select public.configure_storage_policy(true,30,60,1000,2000,1,array['image/png'])");
  await reserve(admin, actors[1], 500);

  const quotaRace = await concurrent(20, (client, index) => reserve(client, actors[0], 300, index % 2 === 1));
  const granted = quotaRace.filter((result) => result.ok);
  const denied = quotaRace.filter((result) => !result.ok);
  check(granted.length === 3, "Twenty mixed upload/output reservations must stop at three 600-byte charges");
  check(denied.length === 17 && denied.every((result) => result.code === "54000"), "All remaining requests must fail account quota");
  check(new Set(granted.map((result) => result.value.object.id)).size === 3, "Every granted reservation must have a distinct server ID");
  check(await chargedBytes(admin, actors[0].userId) === 1800, "Owner charge must equal three immutable staging/sealed reservations");
  check(await chargedBytes(admin, actors[1].userId) === 1000, "Other account quota must remain independent");

  const secondProject = { ...actors[0], projectId: "30000000-0000-4000-8000-000000000020" };
  await admin.query("insert into public.projects(id,owner_id,name) values($1,$2,'Surviving storage project')", [secondProject.projectId, secondProject.userId]);
  const deleting = await connect();
  await authenticated(deleting, actors[0]);
  await deleting.query("begin");
  await deleting.query("delete from public.projects where id=$1", [actors[0].projectId]);
  // Keep deletion uncommitted while other connections reserve in an existing
  // same-owner project. They must see the original charge, never a quota gap.
  const deletionRace = await concurrent(20, (client) => reserve(client, secondProject, 100));
  check(deletionRace.filter((result) => result.ok).length === 1, "Uncommitted project deletion cannot free object charges");
  check(deletionRace.filter((result) => !result.ok).every((result) => result.code === "54000"), "Project deletion race permits only quota denials");
  await deleting.query("commit");
  await close(deleting);
  check(await chargedBytes(admin, actors[0].userId) === 2000, "Project cascade must atomically move charges into cleanup without a gap");
  check((await admin.query("select count(*)::int as count from private.storage_cleanup where owner_id=$1", [actors[0].userId])).rows[0].count === 3, "All deleted project objects must have durable cleanup rows");
  check((await admin.query("select count(*)::int as count from public.project_objects where owner_id=$1", [actors[1].userId])).rows[0].count === 1, "Project deletion must leave other account objects intact");
  check((await admin.query("select count(*)::int as count from private.storage_cleanup where owner_id=$1", [actors[1].userId])).rows[0].count === 0, "Project deletion must not queue another account keys");

  const accountDelete = await connect();
  await accountDelete.query("begin");
  await accountDelete.query("delete from auth.users where id=$1", [actors[1].userId]);
  const competing = await connect();
  await authenticated(competing, actors[1]);
  const waitingReserve = competing.query("select public.reserve_project_upload($1,'during-delete.png','image/png',100)", [actors[1].projectId])
    .then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code }));
  await waitForBlocked(admin, competing);
  check(true, "Reservation must wait for concurrent account/project cascade locks");
  await accountDelete.query("commit");
  const afterDelete = await waitingReserve;
  check(!afterDelete.ok && afterDelete.code === "P0002", "Reservation after account deletion must not create an orphan object");
  await close(competing);
  await close(accountDelete);
  check((await admin.query("select count(*)::int as count from public.project_objects where owner_id=$1", [actors[1].userId])).rows[0].count === 0, "Deleted account must have no surviving object metadata");
  check((await admin.query("select count(*)::int as count from private.storage_cleanup where owner_id=$1", [actors[1].userId])).rows[0].count === 1, "Deleted account object must remain in durable cleanup");
  check(await chargedBytes(admin, actors[0].userId) === 2000, "Account cascade must not alter another owner charges");

  const output = await reserve(admin, actors[2], 100, true);
  const completing = await connect();
  await service(completing);
  await completing.query("begin");
  await completing.query("select public.storage_complete_object($1,$2,$3,'sealed-fixture',100)", [output.object.id, actors[2].projectId, actors[2].userId]);
  const terminal = await connect();
  await service(terminal);
  const waitingTerminal = terminal.query("select public.advance_owned_job($1,$2,$3,'succeeded') as advanced", [actors[2].jobId, actors[2].projectId, actors[2].userId]);
  await waitForBlocked(admin, terminal);
  check(true, "Running-job share lock must serialize completion before terminal transition");
  await completing.query("commit");
  check((await waitingTerminal).rows[0].advanced === true, "Job terminal transition may proceed after verified completion commits");
  await close(completing);
  await close(terminal);
  await admin.query("reset role");
  check((await admin.query("select p.status='ready' and j.status='succeeded' as valid from public.project_objects p join public.jobs j on j.id=p.job_id where p.id=$1", [output.object.id])).rows[0].valid, "Completed object remains bound to its succeeded job");
  await admin.query("update public.jobs set status='running' where id=$1", [actors[2].jobId]);
  const stale = await reserve(admin, actors[2], 100, true);
  await service(admin);
  await admin.query("select public.advance_owned_job($1,$2,$3,'failed')", [actors[2].jobId, actors[2].projectId, actors[2].userId]);
  await assert.rejects(admin.query("select public.storage_complete_object($1,$2,$3,'late-fixture',100)", [stale.object.id, actors[2].projectId, actors[2].userId]), (error) => error.code === "42501");
  assertions += 1;
  await admin.query("reset role");
  check((await admin.query("select status='pending' as pending from public.project_objects where id=$1", [stale.object.id])).rows[0].pending, "Late completion after terminal failure cannot mark an output ready");

  console.log(`PASS: native PostgreSQL ${version}; ${migrations.length} actual migrations; ${assertions} storage assertions with independent connections.`);
  console.log("Scope: local concurrent quota, project/account cascades, durable cleanup charges, account isolation, and job/completion locks.");
  console.log("Not verified: hosted Supabase Auth/RLS, R2 deletion/privacy/URL expiry, provider execution, or production security.");
} catch (error) {
  console.error("Storage concurrency regression failed:", error instanceof Error ? error.message : String(error));
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

