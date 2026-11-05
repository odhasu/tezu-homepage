import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { prepareAdministrativeFixture } from "./administrative-fixture.mjs";

// This runner is intentionally locked to the dedicated staging tenant. Credentials,
// passwords, signed JWTs, and magic-link material stay in memory and are never logged.
// Admin-created, confirmed fixtures and trusted verification finalization do not
// prove human signup, email delivery, Turnstile success, or website cookie handling.
const project = "txwclngedcporvrfbolu";
const url = `https://${project}.supabase.co`;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const identities = [];
const sessions = [];
let admin;
let publishable;
let passed = 0;
let activeCheck = "staging configuration";
let failed = false;
let routeGroups = 0;

function ensure(condition) {
  if (!condition) throw new Error("Verification failed");
}

async function check(name, action) {
  activeCheck = name;
  await action();
  passed += 1;
  console.log(`PASS: ${name}`);
}

// All ownership assertions use real HTTP requests to PostgREST, not SDK database
// mocks or server-role impersonation. Never include response bodies in failures.
async function rest(identity, path, { method = "GET", body, prefer = "return=representation", profile } = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: publishable,
      ...(identity ? { Authorization: `Bearer ${identity.session.access_token}` } : {}),
      "Content-Type": "application/json",
      Prefer: prefer,
      ...(profile ? { "Accept-Profile": profile } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { /* A non-JSON response must fail closed. */ }
  }
  return { ok: response.ok, status: response.status, data };
}

function rows(result) {
  ensure(result.ok && Array.isArray(result.data));
  return result.data;
}

function denied(result) {
  // RLS-filtered UPDATE/DELETE/SELECT can succeed with no visible/changed rows.
  ensure((!result.ok && [401, 403].includes(result.status)) ||
    (result.ok && Array.isArray(result.data) && result.data.length === 0));
}

function rejected(result) {
  // Inserts and attempts to alter immutable columns must reject, not silently pass.
  ensure(!result.ok && result.status >= 400 && result.status < 500);
}

async function insert(identity, table, body) {
  const created = rows(await rest(identity, `${table}?select=*`, { method: "POST", body }));
  ensure(created.length === 1);
  return created[0];
}

async function rpc(identity, name, body) {
  return rest(identity, `rpc/${name}`, { method: "POST", body });
}

async function serviceRpc(name, body) {
  const result = await admin.rpc(name, body);
  ensure(!result.error);
  return result.data;
}

async function signedSession(identity) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: identity.email });
  ensure(!link.error && link.data?.properties?.hashed_token);
  const client = createClient(url, publishable, options);
  const signed = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  ensure(!signed.error && signed.data.session?.access_token && signed.data.session?.refresh_token);
  ensure(signed.data.user?.id === identity.id);
  const session = signed.data.session;
  sessions.push(session);
  return { ...identity, session };
}

async function serviceRpcRejected(name, body) {
  const result = await admin.rpc(name, body);
  ensure(result.error?.code === "42501");
}

async function fixture(label, run) {
  const email = `ownership-${label.toLowerCase()}-${run}@example.invalid`;
  const prepared = await prepareAdministrativeFixture(admin, {
    email, fixtureId: `ownership:${label}:${run}`,
    userMetadata: { owner_id: "forged-owner", credits: 999, verified: true },
  });
  const created = await admin.auth.admin.createUser({
    email,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
    user_metadata: prepared.userMetadata,
  });
  ensure(!created.error && created.data.user?.id);
  // Record the ID immediately so later setup failures still remove this fixture.
  const identity = { label, email, id: created.data.user.id };
  identities.push(identity);
  return signedSession(identity);
}

async function verify(identity) {
  const context = await rpc(identity, "get_auth_context", {});
  ensure(context.ok && context.data?.user_id === identity.id && context.data?.verification === "pending");
  const started = await rpc(identity, "begin_session_verification", {});
  ensure(started.ok && typeof started.data === "string");
  ensure(await serviceRpc("finish_session_verification", {
    p_user_id: identity.id,
    p_session_id: context.data.session_id,
    p_attempt_id: started.data,
    p_success: true,
  }) === true);
}

function jobArgs(identity, job) {
  return { p_job_id: job.id, p_project_id: job.project_id, p_owner_id: identity.id };
}

async function metadataFixture(identity) {
  const first = await insert(identity, "projects", { owner_id: identity.id, name: `${identity.label} project` });
  const second = await insert(identity, "projects", { owner_id: identity.id, name: `${identity.label} second project` });
  const job = await insert(identity, "jobs", { project_id: first.id, owner_id: identity.id, label: `${identity.label} job` });
  const upload = await insert(identity, "uploads", {
    project_id: first.id, owner_id: identity.id, filename: `${identity.label}.png`, content_type: "image/png", byte_size: 32,
  });
  ensure(await serviceRpc("advance_owned_job", { ...jobArgs(identity, job), p_status: "running" }) === true);
  const outputId = await serviceRpc("record_owned_output", {
    ...jobArgs(identity, job), p_filename: `${identity.label}-output.png`, p_content_type: "image/png", p_byte_size: 64,
  });
  ensure(typeof outputId === "string");
  ensure(upload.status === "pending");
  ensure(upload.object_key === `owners/${identity.id}/projects/${first.id}/uploads/${upload.id}`);
  const output = rows(await rest(identity, `outputs?id=eq.${outputId}&select=*`));
  ensure(output.length === 1 && output[0].project_id === first.id && output[0].owner_id === identity.id);
  ensure(output[0].job_id === job.id);
  ensure(output[0].object_key === `owners/${identity.id}/projects/${first.id}/outputs/${output[0].id}`);
  return { first, second, job, upload, output: output[0] };
}

try {
  const cli = process.env.SUPABASE_CLI_BIN;
  ensure(cli?.startsWith("/"));
  const keyResult = spawnSync(cli, ["projects", "api-keys", `--remote=${project}`, "--reveal", "--output", "json"], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000,
  });
  ensure(keyResult.status === 0);
  const keys = JSON.parse(keyResult.stdout);
  publishable = keys.find((key) => key.type === "publishable" && key.disabled !== true)?.api_key;
  const secret = keys.find((key) => key.type === "secret" && key.disabled !== true)?.api_key;
  ensure(publishable && secret);
  admin = createClient(url, secret, options);
  await check("Data API exposes only public and graphql_public schemas", async () => {
    let result = await rest(null, "", { profile: "ownership_probe_not_exposed" });
    // Hosted OpenAPI discovery may require authentication. A zero-row table
    // request still exercises the same server-side exposed-schema allowlist.
    if (result.status === 401) {
      result = await rest(null, "accounts?select=user_id&limit=0", { profile: "ownership_probe_not_exposed" });
    }
    ensure(result.status === 406 && result.data?.code === "PGRST106");
    const source = [result.data.hint, result.data.message].find((value) =>
      typeof value === "string" && value.includes("schemas") && value.includes(":"));
    ensure(source);
    const suffix = source.slice(source.lastIndexOf(":") + 1);
    const schemas = suffix.replace(/\.$/, "").split(",").map((name) => name.trim().replace(/^["'`]|["'`]$/g, "")).sort();
    ensure(schemas.every((name) => /^[a-z_][a-z0-9_]*$/.test(name)));
    console.log(`EXPOSED SCHEMAS: ${schemas.join(", ")}`);
    ensure(JSON.stringify(schemas) === JSON.stringify(["graphql_public", "public"]));
  });
  const run = randomBytes(8).toString("hex");
  activeCheck = "create two disposable real Auth identities";
  const a = await fixture("A", run);
  const b = await fixture("B", run);

  await check("pending real sessions cannot read their account or credit records", async () => {
    for (const identity of [a, b]) {
      ensure(rows(await rest(identity, "accounts?select=*")).length === 0);
      ensure(rows(await rest(identity, "video_credit_accounts?select=*")).length === 0);
      rejected(await rest(identity, "projects", { method: "POST", body: { owner_id: identity.id, name: "pending" } }));
    }
  });
  await check("two real signed sessions complete trusted fixture verification", async () => {
    await verify(a);
    await verify(b);
  });
  let am;
  let bm;
  await check("owners create project and child metadata through direct Data API", async () => {
    am = await metadataFixture(a);
    bm = await metadataFixture(b);
  });

  const tables = [
    { name: "accounts", owner: "user_id", key: "user_id", a: { user_id: a.id }, b: { user_id: b.id }, patch: { display_name: "changed" } },
    { name: "projects", owner: "owner_id", key: "id", a: am.first, b: bm.first, patch: { name: "changed" } },
    { name: "jobs", owner: "owner_id", key: "id", a: am.job, b: bm.job, patch: { label: "changed" } },
    { name: "uploads", owner: "owner_id", key: "id", a: am.upload, b: bm.upload, patch: { filename: "changed.png" } },
    { name: "outputs", owner: "owner_id", key: "id", a: am.output, b: bm.output, patch: { filename: "changed.png" } },
    { name: "video_credit_accounts", owner: "user_id", key: "user_id", a: { user_id: a.id }, b: { user_id: b.id }, patch: { credits: 999 } },
  ];

  for (const table of tables) {
    await check(`${table.name}: each owner sees only its own rows`, async () => {
      for (const [identity, own] of [[a, table.a], [b, table.b]]) {
        const visible = rows(await rest(identity, `${table.name}?select=*`));
        ensure(visible.length > 0 && visible.every((row) => row[table.owner] === identity.id));
        ensure(visible.some((row) => row[table.key] === own[table.key]));
      }
    });
    await check(`${table.name}: cross-owner SELECT, UPDATE, and DELETE fail in both directions`, async () => {
      for (const [attacker, owner, foreign] of [[a, b, table.b], [b, a, table.a]]) {
        const path = `${table.name}?${table.key}=eq.${foreign[table.key]}&select=*`;
        const before = rows(await rest(owner, path));
        ensure(before.length === 1);
        denied(await rest(attacker, path));
        denied(await rest(attacker, path, { method: "PATCH", body: table.patch }));
        denied(await rest(attacker, path, { method: "DELETE" }));
        const after = rows(await rest(owner, path));
        ensure(after.length === 1 && JSON.stringify(after) === JSON.stringify(before));
      }
    });
    await check(`${table.name}: anonymous Data API access denied`, async () => {
      denied(await rest(null, `${table.name}?select=*`));
      denied(await rest(null, `${table.name}?${table.key}=eq.${table.a[table.key]}&select=*`, { method: "PATCH", body: table.patch }));
      denied(await rest(null, `${table.name}?${table.key}=eq.${table.a[table.key]}&select=*`, { method: "DELETE" }));
    });
  }

  await check("anonymous callers cannot insert protected metadata", async () => {
    for (const [table, body] of [
      ["accounts", { user_id: a.id, display_name: "anonymous" }],
      ["projects", { owner_id: a.id, name: "anonymous" }],
      ["jobs", { owner_id: a.id, project_id: am.first.id, label: "anonymous" }],
      ["uploads", { owner_id: a.id, project_id: am.first.id, filename: "anonymous.png", content_type: "image/png", byte_size: 1 }],
      ["outputs", { owner_id: a.id, project_id: am.first.id, job_id: am.job.id, filename: "anonymous.png", content_type: "image/png", byte_size: 1 }],
      ["video_credit_accounts", { user_id: a.id, credits: 999 }],
    ]) rejected(await rest(null, table, { method: "POST", body }));
  });
  await check("service-role clients cannot directly INSERT, UPDATE, or DELETE owned records", async () => {
    const insertion = {
      accounts: { user_id: a.id, display_name: "service" },
      projects: { owner_id: a.id, name: "service" },
      jobs: { owner_id: a.id, project_id: am.first.id, label: "service" },
      uploads: { owner_id: a.id, project_id: am.first.id, filename: "service.png", content_type: "image/png", byte_size: 1 },
      outputs: { owner_id: a.id, project_id: am.first.id, job_id: am.job.id, filename: "service.png", content_type: "image/png", byte_size: 1 },
    };
    for (const table of tables.filter((table) => table.name !== "video_credit_accounts")) {
      const inserted = await admin.from(table.name).insert(insertion[table.name]).select();
      ensure(inserted.error?.code === "42501");
      const updated = await admin.from(table.name).update(table.patch).eq(table.key, table.a[table.key]).select();
      ensure(updated.error?.code === "42501");
      const deleted = await admin.from(table.name).delete().eq(table.key, table.a[table.key]).select();
      ensure(deleted.error?.code === "42501");
    }
  });
  await check("forged account and project owner INSERT rejected", async () => {
    const accountForgery = await rest(a, "accounts", { method: "POST", body: { user_id: b.id, display_name: "forged" } });
    rejected(accountForgery);
    ensure(accountForgery.data?.code === "42501");
    rejected(await rest(a, "projects", { method: "POST", body: { owner_id: b.id, name: "forged" } }));
  });
  for (const [table, fields] of [
    ["jobs", { label: "forged" }],
    ["uploads", { filename: "forged.png", content_type: "image/png", byte_size: 1 }],
  ]) {
    await check(`${table}: forged owner and cross-owner parent INSERT rejected`, async () => {
      for (const ownership of [
        { owner_id: b.id, project_id: bm.first.id },
        { owner_id: a.id, project_id: bm.first.id },
        { owner_id: b.id, project_id: am.first.id },
      ]) rejected(await rest(a, table, { method: "POST", body: { ...ownership, ...fields } }));
    });
  }
  await check("clients cannot insert outputs or forge job/upload completion", async () => {
    rejected(await rest(a, "outputs", { method: "POST", body: {
      owner_id: a.id, project_id: am.first.id, job_id: am.job.id,
      filename: "forged.png", content_type: "image/png", byte_size: 1,
    } }));
    rejected(await rest(a, "jobs", { method: "POST", body: { owner_id: a.id, project_id: am.first.id, status: "succeeded" } }));
    rejected(await rest(a, "uploads", { method: "POST", body: {
      owner_id: a.id, project_id: am.first.id, filename: "forged.png", content_type: "image/png", byte_size: 1, status: "ready",
    } }));
  });

  for (const table of tables.filter((table) => table.name !== "video_credit_accounts")) {
    await check(`${table.name}: owner reassignment rejected`, async () => {
      rejected(await rest(a, `${table.name}?${table.key}=eq.${table.a[table.key]}&select=*`, {
        method: "PATCH", body: { [table.owner]: b.id },
      }));
    });
  }
  for (const table of ["jobs", "uploads", "outputs"]) {
    const record = { jobs: am.job, uploads: am.upload, outputs: am.output }[table];
    await check(`${table}: cross-project and same-owner reparenting rejected`, async () => {
      for (const projectId of [bm.first.id, am.second.id]) {
        rejected(await rest(a, `${table}?id=eq.${record.id}&select=*`, { method: "PATCH", body: { project_id: projectId } }));
      }
    });
  }
  await check("asset keys, output job references, and worker state are immutable to clients", async () => {
    for (const [table, record, body] of [
      ["uploads", am.upload, { object_key: bm.upload.object_key }],
      ["outputs", am.output, { object_key: bm.output.object_key }],
      ["outputs", am.output, { job_id: bm.job.id }],
      ["jobs", am.job, { status: "succeeded" }],
      ["uploads", am.upload, { status: "ready" }],
    ]) rejected(await rest(a, `${table}?id=eq.${record.id}&select=*`, { method: "PATCH", body }));
  });
  await check("upsert cannot change project ownership", async () => {
    rejected(await rest(a, "projects?on_conflict=id&select=*", {
      method: "POST", body: { id: am.first.id, owner_id: b.id, name: "forged upsert" },
      prefer: "resolution=merge-duplicates,return=representation",
    }));
  });
  await check("authenticated and anonymous callers cannot invoke worker RPCs", async () => {
    for (const caller of [a, null]) {
      rejected(await rpc(caller, "advance_owned_job", { ...jobArgs(a, am.job), p_status: "succeeded" }));
      rejected(await rpc(caller, "record_owned_output", {
        ...jobArgs(a, am.job), p_filename: "forged.png", p_content_type: "image/png", p_byte_size: 1,
      }));
    }
  });
  await check("privileged job mutations reject mismatched owner or project", async () => {
    for (const mismatch of [{ p_owner_id: b.id }, { p_project_id: am.second.id }, { p_project_id: bm.first.id }]) {
      ensure(await serviceRpc("advance_owned_job", { ...jobArgs(a, am.job), ...mismatch, p_status: "succeeded" }) === false);
      await serviceRpcRejected("record_owned_output", {
        ...jobArgs(a, am.job), ...mismatch, p_filename: "forged.png", p_content_type: "image/png", p_byte_size: 1,
      });
    }
    const stillRunning = rows(await rest(a, `jobs?id=eq.${am.job.id}&select=status`));
    ensure(stillRunning.length === 1 && stillRunning[0].status === "running");
  });
  await check("worker status transitions cannot skip, regress, or create outputs after completion", async () => {
    ensure(await serviceRpc("advance_owned_job", { ...jobArgs(a, am.job), p_status: "succeeded" }) === true);
    ensure(await serviceRpc("advance_owned_job", { ...jobArgs(a, am.job), p_status: "running" }) === false);
    await serviceRpcRejected("record_owned_output", {
      ...jobArgs(a, am.job), p_filename: "late.png", p_content_type: "image/png", p_byte_size: 1,
    });
    const queued = await insert(a, "jobs", { owner_id: a.id, project_id: am.second.id, label: "queued" });
    ensure(await serviceRpc("advance_owned_job", { ...jobArgs(a, queued), p_status: "succeeded" }) === false);
    ensure(await serviceRpc("advance_owned_job", { ...jobArgs(a, queued), p_status: "cancelled" }) === true);
  });

  await check("a fresh pending JWT cannot read or mutate existing protected metadata", async () => {
    const pending = await signedSession(a);
    for (const table of tables) {
      ensure(rows(await rest(pending, `${table.name}?select=*`)).length === 0);
      denied(await rest(pending, `${table.name}?${table.key}=eq.${table.a[table.key]}&select=*`, { method: "PATCH", body: table.patch }));
      denied(await rest(pending, `${table.name}?${table.key}=eq.${table.a[table.key]}&select=*`, { method: "DELETE" }));
    }
  });
  if (process.env.OWNERSHIP_TEST_ROUTES === "true") {
    activeCheck = "load built Route Handler integration";
    const { verifyOwnershipRoutes } = await import("./ownership-route-checks.mjs");
    await verifyOwnershipRoutes({
      a, b, am, bm, supabaseUrl: url, publishable, secret,
      check: async (name, action) => { await check(name, action); routeGroups += 1; },
      serviceRpc, signedSession, verify, rpc,
    });
  }
  await check("owners can update their editable metadata", async () => {
    for (const table of tables.filter((table) => table.name !== "video_credit_accounts")) {
      const changed = rows(await rest(a, `${table.name}?${table.key}=eq.${table.a[table.key]}&select=*`, {
        method: "PATCH", body: table.patch,
      }));
      ensure(changed.length === 1 && Object.entries(table.patch).every(([key, value]) => changed[0][key] === value));
    }
    rejected(await rest(a, `video_credit_accounts?user_id=eq.${a.id}&select=*`, { method: "PATCH", body: { credits: 999 } }));
  });
  await check("owners can delete and recreate their account metadata without touching another account", async () => {
    ensure(rows(await rest(a, `accounts?user_id=eq.${a.id}&select=*`, { method: "DELETE" })).length === 1);
    const recreated = await insert(a, "accounts", { user_id: a.id, display_name: "restored" });
    ensure(recreated.user_id === a.id && recreated.display_name === "restored");
    ensure(rows(await rest(b, `accounts?user_id=eq.${b.id}&select=*`)).length === 1);
  });
  await check("owners can delete their output, upload, job, and project metadata", async () => {
    for (const [table, record] of [["outputs", am.output], ["uploads", am.upload], ["jobs", am.job], ["projects", am.first]]) {
      ensure(rows(await rest(a, `${table}?id=eq.${record.id}&select=*`, { method: "DELETE" })).length === 1);
      ensure(rows(await rest(a, `${table}?id=eq.${record.id}&select=*`)).length === 0);
    }
    ensure(rows(await rest(b, `projects?id=eq.${bm.first.id}&select=*`)).length === 1);
  });
  await check("revoked real JWT loses access to all owned tables immediately", async () => {
    const revoked = await rpc(b, "revoke_current_session", {});
    ensure(revoked.ok && revoked.data === true);
    for (const table of tables) {
      ensure(rows(await rest(b, `${table.name}?select=*`)).length === 0);
      denied(await rest(b, `${table.name}?${table.key}=eq.${table.b[table.key]}&select=*`, { method: "PATCH", body: table.patch }));
      denied(await rest(b, `${table.name}?${table.key}=eq.${table.b[table.key]}&select=*`, { method: "DELETE" }));
    }
    rejected(await rest(b, "projects", { method: "POST", body: { owner_id: b.id, name: "revoked" } }));
  });
} catch {
  failed = true;
  // Use a controlled test label only. Errors can contain credentials or payloads.
  console.error(`FAIL: ${activeCheck}. No request, credential, or response details logged.`);
} finally {
  let cleanupFailed = false;
  if (admin) {
    for (const session of sessions) {
      try {
        const result = await admin.auth.admin.signOut(session.access_token, "local");
        if (result.error && result.error.status !== 404) cleanupFailed = true;
      } catch { cleanupFailed = true; }
    }
    for (const identity of identities) {
      try {
        const result = await admin.auth.admin.deleteUser(identity.id);
        if (result.error) cleanupFailed = true;
      } catch { cleanupFailed = true; }
    }
  }
  if (cleanupFailed) {
    failed = true;
    console.error("FAIL: disposable staging identity cleanup needs inspection.");
  } else if (identities.length) {
    console.log("CLEANUP: disposable staging identities and dependent rows removed.");
  }
  console.log(`${failed ? "INCOMPLETE" : "PASS"}: ${passed} hosted two-identity ownership assertion groups; ${routeGroups} real Route Handler groups.`);
  console.log("Scope: real Auth identities, signed JWTs, direct Supabase Data API, and privileged database RPCs.");
  console.log("Not proven: public signup/hook/IP quota, human CAPTCHA/email, browser cookie security, deployed HTTP/cache behavior, R2 object access, webhook signatures, or production security.");
  if (process.env.OWNERSHIP_TEST_ROUTES !== "true") console.log("Route Handler integration not requested; set OWNERSHIP_TEST_ROUTES=true after a runtime build to include it.");
  process.exitCode = failed ? 1 : 0;
}
