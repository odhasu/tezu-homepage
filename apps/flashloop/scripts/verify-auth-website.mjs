import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { prepareAdministrativeFixture } from "./administrative-fixture.mjs";

// This is a staging-only integration test, never a public CAPTCHA/email test.
const project = "txwclngedcporvrfbolu";
const origin = "https://kumi-staging.vercel.app";
const url = `https://${project}.supabase.co`;
const cli = process.env.SUPABASE_CLI_BIN;
assert.ok(cli?.startsWith("/"), "Set the trusted absolute Supabase CLI path.");
const keyResult = spawnSync(cli, ["projects", "api-keys", `--remote=${project}`, "--reveal", "--output", "json"], { encoding: "utf8", timeout: 30_000 });
assert.equal(keyResult.status, 0, "Staging key lookup failed.");
const keys = JSON.parse(keyResult.stdout);
const publishable = keys.find((key) => key.type === "publishable")?.api_key;
const secret = keys.find((key) => key.type === "secret")?.api_key;
assert.ok(publishable && secret);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(url, secret, options);
const email = `website-regression-${randomBytes(8).toString("hex")}@example.invalid`;
let userId;
let passed = 0;
const sessions = [];
const check = (name) => { passed += 1; console.log(`PASS: ${name}`); };

function request(path, cookie = "", method = "GET", body = undefined, requestOrigin = origin) {
  const headers = [`Origin: ${requestOrigin}`, "X-Requested-With: flashloop", "Content-Type: application/json"];
  if (cookie) headers.push(`Cookie: ${cookie}`);
  const args = ["curl", `${origin}${path}`, "--scope", "odhasus-projects", "--", "--silent", "--show-error", "--include",
    "--header", "@-", "--request", method, "--write-out", "\nHTTP_STATUS:%{http_code}"];
  if (body !== undefined) args.push("--data-binary", JSON.stringify(body));
  // Cookies go over stdin, never command arguments, output files, or logs.
  const result = spawnSync("/opt/homebrew/bin/vercel", args, { input: headers.join("\n") + "\n", encoding: "utf8", timeout: 40_000 });
  assert.equal(result.status, 0, "Vercel authenticated request failed.");
  const match = result.stdout.match(/\nHTTP_STATUS:(\d+)$/);
  assert.ok(match, "HTTP status missing.");
  const raw = result.stdout.slice(0, match.index);
  const parts = raw.split(/\r?\n\r?\n/);
  const responseHeaders = parts.shift();
  const text = parts.join("\n\n");
  return { status: Number(match[1]), headers: responseHeaders, json: () => JSON.parse(text) };
}

async function signedSession() {
  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email });
  assert.ifError(generated.error);
  const publicAuth = createClient(url, publishable, options);
  const verified = await publicAuth.auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: "magiclink" });
  assert.ifError(verified.error);
  const session = verified.data.session;
  assert.ok(session);
  sessions.push(session);
  let cookies = [];
  const server = createServerClient(url, publishable, { cookies: {
    getAll: () => cookies,
    setAll: (next) => { cookies = next.filter((value) => value.value); },
  } });
  const stored = await server.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  assert.ifError(stored.error);
  return { server, session, cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; ") };
}

try {
  assert.equal(request("/api/account").status, 401);
  check("deployed protected API rejects unauthenticated requests");
  assert.equal(request("/api/auth/signup", "", "POST", { email, password: randomBytes(24).toString("hex") }).status, 403);
  check("deployed signup rejects missing Turnstile tokens");

  const fixture = await prepareAdministrativeFixture(admin, { email, fixtureId: `auth-website:${email}` });
  const created = await admin.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true,
    user_metadata: fixture.userMetadata });
  assert.ifError(created.error);
  userId = created.data.user.id;

  const pending = await signedSession();
  assert.equal(request("/api/account", pending.cookie).status, 403);
  check("deployed API denies a real pending session");
  const failure = request("/api/auth/verify", pending.cookie, "POST", { token: "invalid-staging-token" });
  assert.equal(failure.status, 403);
  assert.ok(/set-cookie:.*Max-Age=0/i.test(failure.headers));
  const stale = request("/api/account", pending.cookie);
  assert.ok([401, 403].includes(stale.status));
  const refreshed = await createClient(url, publishable, options).auth.refreshSession({ refresh_token: pending.session.refresh_token });
  assert.ok(refreshed.error);
  check("failed real Turnstile verification clears cookies, denies existing token, revokes refresh token");

  const verified = await signedSession();
  const context = await verified.server.rpc("get_auth_context");
  assert.ifError(context.error);
  const started = await verified.server.rpc("begin_session_verification");
  assert.ifError(started.error);
  const finish = await admin.rpc("finish_session_verification", { p_user_id: userId, p_session_id: context.data.session_id,
    p_attempt_id: started.data, p_success: true });
  assert.ifError(finish.error);
  assert.equal(finish.data, true);
  const account = request("/api/account", verified.cookie);
  assert.equal(account.status, 200);
  assert.equal(account.json().videoCredits, 0);
  assert.ok(/cache-control:.*private.*no-store/i.test(account.headers));
  check("deployed API accepts a verified session and returns zero credits without caching");

  assert.equal(request("/api/auth/verify", verified.cookie, "POST", {}, "https://attacker.example").status, 403);
  assert.equal(request("/api/account", verified.cookie).status, 200);
  check("CSRF request cannot revoke a legitimate verified session");
  assert.equal(request("/api/auth/verify", verified.cookie, "POST", { token: "invalid-staging-token" }).status, 403);
  assert.ok([401, 403].includes(request("/api/account", verified.cookie).status));
  check("verification failure also revokes an already verified session");
  console.log(`PASS: ${passed} deployed website assertions.`);
  console.log("Not proven here: public signup/hook/IP quota, browser-entered signup credentials, delivered email/PKCE, human challenge success/replay, expired-token browser refresh.");
} finally {
  for (const session of sessions) await admin.auth.admin.signOut(session.access_token, "global").catch(() => undefined);
  if (userId) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    assert.ifError(deleted.error);
    console.log("Disposable staging website user and dependent rows removed.");
  }
}
