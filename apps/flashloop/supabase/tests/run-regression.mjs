import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Supply an installed PGlite module path when it is outside this application's
// dependency tree. No hosted connection, keys, or Auth service is used here.
const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const database = new PGlite();
const root = new URL("../", import.meta.url);
try {
  await database.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
  const migrations = (await readdir(new URL("migrations/", root)))
    .filter((file) => file.endsWith(".sql")).sort();
  assert.ok(migrations.length > 0, "SQL migration is required");
  for (const migration of migrations) {
    await database.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
  }
  const results = await database.exec(await readFile(new URL("tests/auth-regression.sql", root), "utf8"));
  const summary = results.flatMap((result) => result.rows).find((row) => "passed" in row);
  assert.ok(summary, "Regression summary must be returned");
  assert.equal(summary.passed, 69, "All 69 regression assertions must execute");
  console.log(`PASS: ${summary.passed} PostgreSQL security assertions; ${migrations.length} migration applied.`);
  console.log("Scope: executable PostgreSQL roles, RLS, RPCs, permits, credits, and both terminal-failure orderings.");
  console.log("Pending: hosted Auth/CAPTCHA, email delivery, live JWT issuance, and concurrent PostgreSQL connections.");
} catch (error) {
  console.error("SQL regression failed:", error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object" && "query" in error) {
    const query = String(error.query);
    const position = "position" in error ? Number(error.position) - 1 : 0;
    console.error(query.slice(Math.max(0, position - 150), position + 250));
  }
  process.exitCode = 1;
} finally {
  await database.close();
}
