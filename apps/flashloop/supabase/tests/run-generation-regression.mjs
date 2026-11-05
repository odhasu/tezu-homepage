import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const { PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite");
const database = new PGlite();
const root = new URL("../", import.meta.url);
try {
  await database.exec(await readFile(new URL("tests/auth-fixture.sql", root), "utf8"));
  const migrations = (await readdir(new URL("migrations/", root)))
    .filter((file) => file.endsWith(".sql") && !file.endsWith("_whop_subscription_billing.sql")).sort();
  for (const migration of migrations) {
    await database.exec(await readFile(new URL(`migrations/${migration}`, root), "utf8"));
  }
  const results = await database.exec(await readFile(new URL("tests/generation-regression.sql", root), "utf8"));
  const summary = results.flatMap((result) => result.rows).find((row) => "passed" in row);
  assert.ok(summary, "Generation regression summary must be returned");
  assert.equal(summary.passed, 76, "All 76 generation assertions must execute");
  console.log(`PASS: ${summary.passed} generation authorization, idempotency, quota, and reconciliation assertions; ${migrations.length} migrations applied.`);
  console.log("Scope: missing/forged subjects, revoked sessions, explicit entitlement, zero credits, project ownership, atomic owned jobs and reservations, persisted provider profiles, single dispatch claim, kill switch, unknown outcomes, safe release, actual-cost/outcome replay, account/global limits, prior-day exposure, overage accounting, and deletion restrictions.");
  console.log("Limits: sequential disposable PostgreSQL with synthetic Auth rows; no hosted Supabase Auth, independent concurrent connections, provider billing, signed Inngest events, or production security claim.");
} catch (error) {
  console.error("Generation SQL regression failed:", error instanceof Error ? error.message : String(error));
  if (error && typeof error === "object" && "query" in error) {
    const query = String(error.query);
    console.error(query.slice(0, 500));
  }
  process.exitCode = 1;
} finally {
  await database.close();
}
