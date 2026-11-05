#!/usr/bin/env node

// Execute the same server telemetry boundary without adding a public crash route.
const { readFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const sourceRoot = resolve(__dirname, "../src/lib/observability");
const modules = new Map();
function load(name) {
  const path = resolve(sourceRoot, name + ".ts");
  if (dirname(path) !== sourceRoot) throw new Error("Invalid telemetry module.");
  if (modules.has(path)) return modules.get(path).exports;
  const module = { exports: {} };
  modules.set(path, module);
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, process, URL,
    require(id) {
      if (id === "server-only") return {};
      if (id.startsWith("./")) return load(id.slice(2));
      if (id === "@sentry/node" || id === "node:crypto") return require(id);
      throw new Error("Invalid telemetry dependency.");
    },
  }, { filename: path });
  return module.exports;
}

async function main() {
  const { sentryConfig } = load("sentry-config");
  const config = sentryConfig();
  if (config?.environment !== "staging" || process.env.SENTRY_STAGING_PROBE !== "true") {
    throw new Error("Probe requires approved staging configuration and SENTRY_STAGING_PROBE=true.");
  }
  const { newRequestId } = load("correlation");
  const { traceOperation, reportFailure, markOperationFailed, flushTelemetry } = load("sentry");
  const correlation = { requestId: newRequestId(), jobId: newRequestId(), generationRequestId: newRequestId() };
  let eventId;
  await traceOperation("staging_probe", correlation, async () => {
    markOperationFailed();
    eventId = reportFailure("staging_probe", correlation);
  });
  const flushed = await flushTelemetry(5000);
  if (!eventId || !flushed) throw new Error("Probe did not flush successfully; verify Sentry ingestion before retrying.");
  console.log(JSON.stringify({ eventId, ...correlation, flushed, environment: "staging" }));
  console.log("Transport flushed. Confirm this exact event and correlated span in the staging Sentry project; flush alone does not prove ingestion.");
}

main().catch(() => {
  console.error("Sentry staging probe incomplete. Check required environment variable names and staging ingestion; configuration values are not logged.");
  process.exitCode = 1;
});
