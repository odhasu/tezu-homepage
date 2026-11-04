import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// Deliberately fixed to the dedicated staging project. This script never sends email.
const project = "txwclngedcporvrfbolu";
const url = `https://${project}.supabase.co`;
const cli = process.env.SUPABASE_CLI_BIN;
assert.ok(cli?.startsWith("/"), "Set SUPABASE_CLI_BIN to the trusted absolute CLI path.");
const keyResult = spawnSync(cli, ["projects", "api-keys", `--remote=${project}`, "--reveal", "--output", "json"], {
  encoding: "utf8", timeout: 30_000,
});
assert.equal(keyResult.status, 0, "Staging key lookup failed.");
const keys = JSON.parse(keyResult.stdout);
const publishable = keys.find((key) => key.type === "publishable")?.api_key;
const secret = keys.find((key) => key.type === "secret")?.api_key;
assert.ok(publishable && secret, "Staging modern keys missing.");
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secret, options);
const anonymous = createClient(url, publishable, options);
const run = randomBytes(8).toString("hex");
const email = `auth-regression-${run}@example.invalid`;
const password = randomBytes(24).toString("base64url");
let userId;
const sessions = [];
let passed = 0;
const check = (name) => { passed += 1; console.log(`PASS: ${name}`); };

try {
  for (const [name, captchaToken] of [["missing", undefined], ["invalid", "invalid-regression-token"]]) {
    const result = await anonymous.auth.signUp({ email: `negative-${run}@example.invalid`, password, options: { captchaToken } });
    assert.ok(result.error, `${name} CAPTCHA must fail.`);
    assert.equal(result.error.code, "captcha_failed", "Native CAPTCHA must reject before account creation.");
    check(`direct Auth signup rejects ${name} CAPTCHA`);
  }
  const unauthorized = await anonymous.rpc("issue_signup_permit", { p_email: email, p_permit_hash: "0".repeat(64) });
  assert.ok(unauthorized.error, "Anonymous callers must not issue signup permits.");
  check("anonymous callers cannot issue signup permits");

  // Trusted administration creates a disposable fixture; this does not prove email delivery or a human CAPTCHA.
  const permit = randomBytes(32).toString("hex");
  const issued = await admin.rpc("issue_signup_permit", { p_email: email, p_permit_hash: createHash("sha256").update(permit).digest("hex") });
  assert.ifError(issued.error);
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true,
    user_metadata: { signup_permit: permit, verified: true, credits: 999 } });
  assert.ifError(created.error);
  userId = created.data.user.id;
  const balance = await admin.from("video_credit_accounts").select("credits").eq("user_id", userId).single();
  assert.ifError(balance.error);
  assert.equal(balance.data.credits, 0);
  check("real Auth-created account receives exactly zero video credits despite metadata forgery");

  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  assert.ifError(link.error);
  const signed = await anonymous.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: "magiclink" });
  assert.ifError(signed.error);
  const session = signed.data.session;
  assert.ok(session?.access_token && session.refresh_token);
  sessions.push(session);
  const user = createClient(url, publishable, { ...options, global: { headers: { Authorization: `Bearer ${session.access_token}` } } });
  const pending = await user.rpc("get_auth_context");
  assert.ifError(pending.error);
  assert.equal(pending.data.verification, "pending");
  assert.equal(pending.data.email_confirmed, true);
  const hidden = await user.from("video_credit_accounts").select("credits");
  assert.ifError(hidden.error);
  assert.equal(hidden.data.length, 0);
  check("real signed JWT cannot read protected credits before session verification");

  const started = await user.rpc("begin_session_verification");
  assert.ifError(started.error);
  assert.equal(typeof started.data, "string");
  const finishArgs = { p_user_id: userId, p_session_id: pending.data.session_id, p_attempt_id: started.data };
  const finished = await admin.rpc("finish_session_verification", { ...finishArgs, p_success: true });
  assert.ifError(finished.error);
  assert.equal(finished.data, true);
  const visible = await user.from("video_credit_accounts").select("credits");
  assert.ifError(visible.error);
  assert.equal(visible.data.length, 1);
  assert.equal(visible.data[0].credits, 0);
  check("verified live session can read its own zero balance");

  const failed = await admin.rpc("finish_session_verification", { ...finishArgs, p_success: false });
  assert.ifError(failed.error);
  const stale = await user.from("video_credit_accounts").select("credits");
  assert.ifError(stale.error);
  assert.equal(stale.data.length, 0);
  const restored = await admin.rpc("finish_session_verification", { ...finishArgs, p_success: true });
  assert.ifError(restored.error);
  assert.equal(restored.data, false);
  check("terminal failure denies the same existing signed JWT and cannot be restored");

  const signout = await admin.auth.admin.signOut(session.access_token, "local");
  assert.ifError(signout.error);
  const loggedOut = await user.rpc("get_auth_context");
  assert.ifError(loggedOut.error);
  assert.equal(loggedOut.data, null);
  const refreshed = await anonymous.auth.refreshSession({ refresh_token: session.refresh_token });
  assert.ok(refreshed.error);
  check("supported local logout removes session and rejects old refresh token");
  console.log(`PASS: ${passed} hosted Auth/database assertions.`);
  console.log("Not proven here: human Turnstile success/replay, website cookie flow, or delivered confirmation email.");
} finally {
  for (const session of sessions) await admin.auth.admin.signOut(session.access_token, "global").catch(() => undefined);
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    assert.ifError(deleted.error);
    console.log("Disposable staging user and dependent rows removed.");
  }
}
