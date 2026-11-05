import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const database = new PGlite();
const root = new URL("../", import.meta.url);
try {
  await database.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
  const migrations = (await readdir(new URL("migrations/", root))).filter((file) => file.endsWith(".sql") && !file.endsWith("_whop_subscription_billing.sql")).sort();
  for (const migration of migrations) await database.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
  const results = await database.exec(await readFile(new URL("tests/storage-regression.sql", root), "utf8"));
  const summary = results.flatMap((result) => result.rows).find((row) => "passed" in row);
  assert.ok(summary, "Storage regression summary is required");
  assert.equal(summary.passed, 51, "All storage assertions must execute");
  console.log(`PASS: ${summary.passed} PostgreSQL storage assertions; ${migrations.length} migrations applied.`);
  const rollback = await readFile(new URL("rollback/20261104211046_private_project_objects.sql", root), "utf8");
  await database.exec(`begin;
    insert into public.projects(id,owner_id,name) values('33000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000001','Rollback fixture');
    insert into public.project_objects(owner_id,project_id,kind,filename,content_type,byte_size,upload_expires_at,retention_expires_at)
    values('10000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000099','upload','fixture.png','image/png',1,now(),now());`);
  await assert.rejects(database.exec(rollback), (error) => error.code === "55000", "Rollback must refuse object metadata");
  await database.exec("rollback;");
  await database.exec(`begin; insert into private.storage_cleanup(id,owner_id,project_id,staging_key,object_key,byte_size,not_before)
    values(gen_random_uuid(),'10000000-0000-4000-8000-000000000001',gen_random_uuid(),'test-staging','test-object',2,now());`);
  await assert.rejects(database.exec(rollback), (error) => error.code === "55000", "Rollback must refuse pending physical cleanup");
  await database.exec("rollback;");
  await database.exec(rollback);
  const parent = await database.query("select to_regclass('public.project_objects') is null as removed,(select relrowsecurity and relforcerowsecurity from pg_class where oid='public.projects'::regclass) as parent_rls");
  assert.deepEqual(parent.rows, [{ removed: true, parent_rls: true }]);
  const storageMigration = migrations.find((file) => file.endsWith("_private_project_objects.sql"));
  assert.ok(storageMigration);
  await database.exec(await readFile(new URL(`migrations/${storageMigration}`, root), "utf8"));
  console.log("PASS: populated metadata and pending cleanup rollback refusal, empty rollback, retained parent RLS, and reapply.");
  console.log("Scope: PostgreSQL RLS/grants, generated keys, explicit policy, reservation quota, worker tuples, expiry, cascades, and durable exact-key cleanup.");
  console.log("Not verified: hosted RLS/concurrency, R2 bucket privacy, signed URL enforcement/expiry, real uploads, or production security.");
} catch (error) {
  console.error("Storage SQL regression failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await database.close();
}
