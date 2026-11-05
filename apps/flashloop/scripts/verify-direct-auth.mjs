import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// Fixed to dedicated staging. Only negative requests are sent; no fixtures or
// configuration changes are permitted. API keys stay in process memory.
const project = "txwclngedcporvrfbolu";
const url = `https://${project}.supabase.co`;
const cli = process.env.SUPABASE_CLI_BIN;
let passed = 0;

function fail(name) {
  throw new Error(name);
}

try {
  if (!cli?.startsWith("/")) fail("TrustedCliPathMissing");
  const keyResult = spawnSync(cli, ["projects", "api-keys", `--remote=${project}`, "--output", "json"], {
    encoding: "utf8", timeout: 30_000,
  });
  if (keyResult.status !== 0) fail("StagingKeyLookupFailed");
  let keys;
  try { keys = JSON.parse(keyResult.stdout); } catch { fail("StagingKeyResponseInvalid"); }
  if (!Array.isArray(keys)) fail("StagingKeyResponseInvalid");
  const publishable = keys.find((key) => key.type === "publishable")?.api_key;
  if (typeof publishable !== "string" || !publishable.startsWith("sb_publishable_") || publishable.includes("*")) {
    fail("StagingPublishableKeyUnavailable");
  }
  const anonymous = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
  });
  const run = randomBytes(12).toString("hex");
  const email = `negative-edge-${run}@example.invalid`;
  const password = randomBytes(24).toString("base64url");

  for (const [name, captchaToken] of [["missing", undefined], ["invalid", "invalid-edge-regression-token"]]) {
    const result = await anonymous.auth.signUp({ email, password, options: { captchaToken } });
    if (result.error?.code !== "captcha_failed") fail("NativeCaptchaRejectionNotConfirmed");
    passed++;
    console.log(`PASS: direct Auth rejects ${name} CAPTCHA with captcha_failed.`);
  }
  const permit = await anonymous.rpc("issue_signup_permit", { p_email: email, p_permit_hash: "0".repeat(64) });
  if (permit.error?.code !== "42501") fail("AnonymousPermitPermissionDenialNotConfirmed");
  passed++;
  console.log("PASS: anonymous signup permit issuance denied with 42501.");
  console.log(`PASS: ${passed} hosted negative assertions; no fixture users or configuration changes.`);
  console.log("Not proven: human CAPTCHA success, email delivery, PKCE callback, or production security.");
} catch (error) {
  const allowed = new Set([
    "TrustedCliPathMissing", "StagingKeyLookupFailed", "StagingKeyResponseInvalid", "StagingPublishableKeyUnavailable",
    "NativeCaptchaRejectionNotConfirmed", "AnonymousPermitPermissionDenialNotConfirmed",
  ]);
  const category = error instanceof Error && allowed.has(error.message) ? error.message : "HostedNegativeCheckFailed";
  console.error(`FAIL: ${category}; passed ${passed} hosted negative assertions.`);
  process.exitCode = 1;
}
