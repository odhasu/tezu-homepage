// Existing boundary tests isolate authorization and jobs from telemetry transport.
// The real wrapper and real SDK have separate tests; these stubs grant no access.
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../../src/lib/http/cache-policy.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: moduleValue.exports, module: moduleValue });
module.exports = {
  "@/lib/http/cache-policy": moduleValue.exports,
  "@/lib/observability/correlation": { newRequestId: require("node:crypto").randomUUID },
  "@/lib/observability/sentry": {
    traceOperation: (_operation, _correlation, callback) => callback(),
    flushTelemetry: async () => false,
  },
  "@/lib/observability/request": {
    observeRequest: (_request, _operation, callback) => callback(),
    authOperation: (operation) => operation,
  },
};
