import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const database = new PGlite();
const root = new URL("../", import.meta.url);
const rollback = await readFile(new URL("rollback/20261105124533_durable_generation_jobs.sql", root), "utf8");
try {
  await database.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
  const migrations = (await readdir(new URL("migrations/", root))).filter((file) => file.endsWith(".sql") && !file.endsWith("_whop_subscription_billing.sql")).sort();
  for (const migration of migrations) await database.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
  // Apply the new migration over existing active requests, including jobs whose
  // provider response was lost before this milestone introduced its outbox.
  const backfill = new PGlite();
  try {
    await backfill.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
    const migrationName = migrations.find((file) => file.endsWith("_durable_generation_jobs.sql"));
    assert.ok(migrationName, "Durable job migration must exist");
    for (const migration of migrations.filter((file) => file !== migrationName)) {
      await backfill.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
    }
    await backfill.exec(`
      insert into auth.users(id,email,email_confirmed_at) values('91000000-0000-4000-8000-000000000001','backfill@example.test',now());
      insert into auth.sessions(id,user_id) values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001');
      insert into private.session_verifications(session_id,user_id,state,verified_at) values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','verified',now());
      insert into public.projects(id,owner_id,name) values('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Backfill fixture');
      update public.video_credit_accounts set credits=1000 where user_id='91000000-0000-4000-8000-000000000001';
      set role service_role;
      select public.configure_generation_policy(true,'USD',10000,10000,10,'UTC');
      select public.configure_generation_account('91000000-0000-4000-8000-000000000001',true);
      select public.upsert_generation_price('backfill.fixture',10,100,'{"provider":"fixture","model":"bounded"}',true);
      select public.reserve_generation_for_user('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','backfill-request-'||i,'backfill.fixture','Stored prompt','Fixture') from generate_series(1,4) i;
      select public.claim_generation('91000000-0000-4000-8000-000000000001','backfill-request-'||i) from generate_series(2,4) i;
      select public.mark_generation_unknown('91000000-0000-4000-8000-000000000001','backfill-request-3');
      select public.mark_generation_dispatched('91000000-0000-4000-8000-000000000001','backfill-request-4','backfilled-provider-job');
      reset role;
    `);
    await backfill.exec(await readFile(new URL(`migrations/${migrationName}`, root), "utf8"));
    await backfill.exec("set role service_role");
    const contexts = (await backfill.query("select public.generation_dispatch_batch(100) as value")).rows[0].value;
    assert.equal(contexts.length, 4, "All pre-migration active jobs enter durable delivery/recovery");
    assert.deepEqual(contexts.map((row) => row.status).sort(), ["reserved","dispatching","unknown","dispatched"].sort(), "Backfill retains every active status");
    assert.equal(contexts.find((row) => row.status === "dispatched").providerJobId, "backfilled-provider-job", "Backfill preserves authoritative provider identity");
    await backfill.exec("reset role");
    assert.equal((await backfill.query("select count(*)::int as count from private.provider_job_bindings")).rows[0].count, 1, "Existing accepted job gets unique provider binding");
    console.log("PASS: 4 populated-schema migration/backfill assertions.");
    await assert.rejects(backfill.exec(rollback), (error) => error.code === "55000" && error.message.includes("disabled first"), "Rollback requires disabled generation");
    await backfill.exec("rollback; set role service_role; select public.set_generation_enabled(false); reset role;");
    await assert.rejects(backfill.exec(rollback), (error) => error.code === "55000" && error.message.includes("provider job bindings"), "Rollback preserves provider job bindings");
    await backfill.exec("rollback; begin; delete from private.provider_job_bindings;");
    await assert.rejects(backfill.exec(rollback), (error) => error.code === "55000" && error.message.includes("durable dispatch records"), "Rollback preserves durable outbox records");
    await backfill.exec("rollback; begin; delete from private.provider_job_bindings; delete from private.job_dispatch_outbox;");
    await assert.rejects(backfill.exec(rollback), (error) => error.code === "55000" && error.message.includes("outstanding generation obligations"), "Rollback independently preserves financial obligations");
    await backfill.exec("rollback; set role service_role;");
    await backfill.query("select public.apply_generation_callback('fixture','rollback-receipt','backfilled-provider-job','running',null,$1)", ["a".repeat(64)]);
    await backfill.exec("reset role");
    await assert.rejects(backfill.exec(rollback), (error) => error.code === "55000" && error.message.includes("callback replay receipts"), "Rollback preserves callback replay receipts");
    await backfill.exec("rollback");
  } finally { await backfill.close(); }
  const results = await database.exec(await readFile(new URL("tests/jobs-regression.sql", root), "utf8"));
  const summary = results.flatMap((result) => result.rows).find((row) => "passed" in row);
  assert.ok(summary, "Job regression summary must be returned");
  assert.equal(summary.passed, 51, "All 51 job assertions must execute");
  console.log(`PASS: ${summary.passed} durable dispatch, provider binding, replay, atomic callback settlement, and permission assertions; ${migrations.length} real migrations applied.`);
  await database.exec(rollback);
  const restored = await database.query(`select
    to_regclass('private.job_dispatch_outbox') is null as outbox_removed,
    to_regclass('private.provider_job_bindings') is null as bindings_removed,
    to_regclass('private.provider_callback_events') is null as receipts_removed,
    to_regprocedure('private.transition_generation_base(uuid,text,text,text,bigint,text)') is null as base_removed,
    has_function_privilege('service_role','private.transition_generation(uuid,text,text,text,bigint,text)','EXECUTE') as worker_allowed,
    not has_function_privilege('authenticated','private.transition_generation(uuid,text,text,text,bigint,text)','EXECUTE') as user_denied,
    (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.projects'::regclass) as parent_rls`);
  assert.deepEqual(restored.rows, [{ outbox_removed: true, bindings_removed: true, receipts_removed: true, base_removed: true, worker_allowed: true, user_denied: true, parent_rls: true }], "Empty rollback restores original capability and preserves parent RLS");
  const original = await database.exec(await readFile(new URL("tests/generation-regression.sql", root), "utf8"));
  assert.equal(original.flatMap((result) => result.rows).find((row) => "passed" in row)?.passed, 76, "Restored transition passes all historical entitlement regressions");
  const jobMigration = migrations.find((file) => file.endsWith("_durable_generation_jobs.sql"));
  assert.ok(jobMigration);
  await database.exec(await readFile(new URL(`migrations/${jobMigration}`, root), "utf8"));
  const reapplied = await database.exec(await readFile(new URL("tests/jobs-regression.sql", root), "utf8"));
  assert.equal(reapplied.flatMap((result) => result.rows).find((row) => "passed" in row)?.passed, 51, "Reapplied migration passes every job regression");
  console.log("PASS: 8 guarded rollback, original transition/grant restoration, parent RLS, and reapplication assertions; restored entitlement suite also passed 76 assertions.");
  console.log("Limits: disposable PostgreSQL with synthetic Auth; no hosted Auth, provider signing/idempotency/billing, Inngest transport, or production security claim.");
} catch (error) {
  console.error("Job SQL regression failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
