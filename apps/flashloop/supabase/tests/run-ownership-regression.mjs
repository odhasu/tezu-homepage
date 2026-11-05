import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const database = new PGlite();
const rollbackDatabase = new PGlite();
const root = new URL("../", import.meta.url);
async function auditDatabase(db) {
  const results = await db.exec(await readFile(new URL("tests/ownership-audit.sql", root), "utf8"));
  const audit = results.flatMap((result) => result.rows).find((row) => "audit" in row)?.audit;
  assert.equal(audit?.passed, true, "Catalog ownership audit must have no violations");
  assert.equal(audit.violation_count, 0);
}
try {
  await database.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
  const migrations = (await readdir(new URL("migrations/", root))).filter((file) => file.endsWith(".sql") && !file.endsWith("_whop_subscription_billing.sql")).sort();
  for (const migration of migrations) await database.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
  const results = await database.exec(await readFile(new URL("tests/ownership-regression.sql", root), "utf8"));
  const summary = results.flatMap((result) => result.rows).find((row) => "passed" in row);
  assert.ok(summary, "Ownership regression summary is required");
  assert.equal(summary.passed, 103, "All 103 ownership assertions must execute");
  await auditDatabase(database);
  console.log(`PASS: ${summary.passed} PostgreSQL ownership assertions and catalog audit; ${migrations.length} migrations applied.`);

  // An old migration's rollback cannot drop financial dependencies introduced by
  // later migrations. Exercise its original contract on its own historical state.
  await rollbackDatabase.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
  const ownershipIndex = migrations.findIndex((file) => file.endsWith("_project_ownership.sql"));
  assert.ok(ownershipIndex >= 0);
  for (const migration of migrations.slice(0, ownershipIndex + 1)) {
    await rollbackDatabase.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
  }
  const rollback = await readFile(new URL("rollback/20261104202356_project_ownership.sql", root), "utf8");
  await assert.rejects(rollbackDatabase.exec(rollback), (error) => error.code === "55000", "Rollback must refuse populated tables");
  await rollbackDatabase.exec("rollback; delete from public.accounts;");
  await rollbackDatabase.exec(rollback);
  const absent = await rollbackDatabase.query("select to_regclass('public.projects') is null as removed, to_regclass('public.video_credit_accounts') is not null as auth_retained, (select count(*)::int from pg_trigger where tgname='video_credit_accounts_immutable_identity') as credit_identity_triggers");
  assert.deepEqual(absent.rows, [{ removed: true, auth_retained: true, credit_identity_triggers: 1 }]);
  await assert.rejects(rollbackDatabase.exec("update public.video_credit_accounts set user_id=gen_random_uuid()"), (error) => error.code === "23514", "Credit identity protection must survive rollback");
  await rollbackDatabase.exec(await readFile(new URL(`migrations/${migrations[ownershipIndex]}`, root), "utf8"));
  await auditDatabase(rollbackDatabase);
  console.log("PASS: historical populated rollback refusal, empty rollback, retained credit protection, and reapply.");
  console.log("Scope: PostgreSQL roles, RLS, constraints, immutable ownership, worker capabilities, and historical rollback. Not hosted Auth.");
} catch (error) {
  console.error("Ownership SQL regression failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.close();
  await rollbackDatabase.close();
}
