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

const clusterRoot = await mkdtemp(join(tmpdir(), "flashloop-billing-postgres-"));
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
  const migrations = (await readdir(new URL("migrations/", databaseRoot))).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) await admin.query(await readFile(new URL(`migrations/${migration}`, databaseRoot), "utf8"));
  await admin.query(await readFile(new URL("tests/billing-regression.sql",databaseRoot),"utf8"));
  const user="b0000000-0000-4000-8000-000000000001", session="b1000000-0000-4000-8000-000000000001", project="b2000000-0000-4000-8000-000000000001";
  async function rpc(client,name,args=[]) {
    await service(client);
    return (await client.query(`select public.${name}(${args.map((_,i)=>"$"+(i+1)).join(",")}) as value`,args)).rows[0].value;
  }
  await rpc(admin,"configure_billing_policy",["sandbox","company_fixture",true]);
  await rpc(admin,"configure_billing_plan",["sandbox","starter","plan_fixture","product_fixture",100,"USD",1000,true]);
  await rpc(admin,"billing_begin_link",[user,session,"a".repeat(64)]);
  await rpc(admin,"billing_consume_link",[user,session,"a".repeat(64)]);
  await rpc(admin,"billing_bind_identity",[user,session,"whop_fixture"]);
  const intents=await concurrent(20,c=>rpc(c,"billing_begin_checkout",[user,session,"starter","checkout-request-000001"]));
  check(intents.every(x=>x.ok),"All racing checkout requests reuse a durable intent");
  check(intents.filter(x=>x.value.createAllowed).length===1,"Exactly one checkout creation permission");
  check(new Set(intents.map(x=>x.value.intentId)).size===1,"Every checkout retry returns same intent");
  await rpc(admin,"billing_finish_checkout",[intents[0].value.intentId,"checkout_fixture"]);
  const now=Date.now(); const begin=new Date(now-3600000).toISOString(),end=new Date(now+86400000*30).toISOString(),at=new Date(now-1000).toISOString();
  const evidence={membershipId:"membership_fixture",paymentId:"payment_fixture",periodStart:begin,periodEnd:end};
  const receipts=await concurrent(20,c=>rpc(c,"billing_receive_webhook",["sandbox","event_fixture","membership.activated","membership_fixture","b".repeat(64),evidence]));
  check(receipts.every(x=>x.ok),"Duplicate webhook race returns durable receipt");
  check(receipts.filter(x=>!x.value.duplicate).length===1,"One verified webhook receipt inserted");
  const receiptId=receipts[0].value.receiptId;
  const snapshot={environment:"sandbox",companyId:"company_fixture",resourceId:"membership_fixture",whopUserId:"whop_fixture",observedAt:new Date().toISOString(),membership:{id:"membership_fixture",planKey:"starter",planId:"plan_fixture",productId:"product_fixture",status:"active",valid:true,periodStart:begin,periodEnd:end,cancelAtPeriodEnd:false},payment:{id:"payment_fixture",membershipId:"membership_fixture",planId:"plan_fixture",checkoutId:"checkout_fixture",status:"paid",paid:true,refunded:false,disputed:false,billingReason:"subscription_create",amountMinor:1000,currency:"USD",createdAt:at,paidAt:at,periodProven:true}};
  const grants=await concurrent(20,c=>rpc(c,"billing_apply_snapshot",[receiptId,snapshot]));
  check(grants.every(x=>x.ok),"Concurrent snapshot applications succeed idempotently");
  check(grants.filter(x=>x.value.grantedCredits===100).length===1,"Single paid collection grants once");
  await admin.query("reset role");
  check((await admin.query("select credits from public.video_credit_accounts where user_id=$1",[user])).rows[0].credits==="100","Account receives exactly one paid grant");
  check((await admin.query("select count(*)::int n from private.billing_credit_buckets")).rows[0].n===1,"One period bucket survives snapshot race");
  const replayGrants=await concurrent(20,async(c,i)=>{
    const r=await rpc(c,"billing_receive_webhook",["sandbox","replay_event_"+i,"membership.activated","membership_fixture","c".repeat(64),evidence]);
    return rpc(c,"billing_apply_snapshot",[r.receiptId,snapshot]);
  });
  check(replayGrants.every(x=>x.ok&&x.value.grantedCredits===0),"Distinct webhook IDs for same payment cannot mint again");
  await rpc(admin,"configure_generation_policy",[true,"USD",10000,10000,100,"UTC"]);
  await rpc(admin,"configure_generation_account",[user,true,null,null]);
  await rpc(admin,"upsert_generation_price",["billing.video",10,100,{provider:"fixture",model:"fixed"},true]);
  const reserves=await concurrent(20,(c,i)=>rpc(c,"reserve_generation_for_user",[user,session,project,"billing-reserve-"+String(i).padStart(4,"0"),"billing.video","prompt","fixture"]));
  check(reserves.filter(x=>x.ok).length===10,"Exactly ten funded requests win reservation race");
  check(reserves.filter(x=>!x.ok).every(x=>x.code==="P0001"),"Remaining reservations deny insufficient credits");
  await admin.query("reset role");
  check((await admin.query("select credits from public.video_credit_accounts where user_id=$1",[user])).rows[0].credits==="0","Racing reservations cannot overdraft balance");
  check((await admin.query("select credits_remaining from private.billing_credit_buckets")).rows[0].credits_remaining==="0","Racing reservations allocate bucket exactly once");
  const key=reserves.find(x=>x.ok).value.requestKey;
  const refund=structuredClone(snapshot);refund.payment.refunded=true;refund.resourceId="refund_fixture";refund.observedAt=new Date().toISOString();
  const rr=await rpc(admin,"billing_receive_webhook",["sandbox","refund_fixture","refund.created","refund_fixture","d".repeat(64),{}]);
  const race=await concurrent(2,(c,i)=>i===0?rpc(c,"claim_generation",[user,key]):rpc(c,"billing_apply_snapshot",[rr.receiptId,refund]));
  check(race[1].ok,"Refund hold commits while claims race");
  check(race[0].ok||race[0].code==="42501","Dispatch either precedes hold or is denied");
  await admin.query("reset role");
  const holds=await admin.query("select count(*)::int n,sum(held_cost_micros)::text cost from private.generation_reservations where status in ('reserved','dispatching')");
  check(holds.rows[0].n===10&&holds.rows[0].cost==="1000","Refund race preserves all in-flight financial holds");
  check((await rpc(admin,"billing_account",[user,session])).billingAccess===false,"Refund review denies all later billing authorization");
  console.log(`PASS: native PostgreSQL ${version}; ${assertions} billing concurrency assertions with independent connections.`);
  console.log("Local synthetic Auth/provider facts only; no hosted billing or provider acceptance.");
} catch (error) {
  console.error("Billing concurrency regression failed:", error instanceof Error ? error.message : String(error));
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
