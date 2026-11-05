import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const database = new PGlite();
const root = new URL("../", import.meta.url);
try {
  await database.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
  const migrations = (await readdir(new URL("migrations/", root))).filter((file) => file.endsWith(".sql") && !file.endsWith("_whop_subscription_billing.sql")).sort();
  for (const migration of migrations) await database.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
  const results = await database.exec(await readFile(new URL("tests/signup-quota-regression.sql", root), "utf8"));
  const summary = results.flatMap((result) => result.rows).find((row) => "passed" in row);
  assert.ok(summary, "Signup quota regression summary is required");
  assert.equal(summary.passed, 55, "All 55 signup quota assertions must execute");
  console.log(`PASS: ${summary.passed} rolling signup quota assertions; ${migrations.length} migrations applied locally.`);
  console.log("Scope: 2 successful accounts per IP per rolling 96 hours, persisted hook claims, insert rollback, deletion resistance, grants, and maintenance bounds.");
  console.log("Pending: hosted Auth hook/insert integration, simultaneous independent PostgreSQL connections, and trusted edge IP handling.");
} catch (error) {
  console.error("Signup quota SQL regression failed:", error instanceof Error ? error.message : "Unknown SQL failure");
  process.exitCode = 1;
} finally {
  await database.close();
}
