# Signup and session verification database

This directory contains the database portion of the Flashloop signup and verification flow. It does not connect to or mutate a hosted project by itself. The migration was created with Supabase CLI 3.0.0 and executed in a disposable PostgreSQL runtime for regression checks.

## Required hosted setup

Apply the migration only to the dedicated `kumi` project after confirming its project reference. Enable the supported Supabase **Before User Created** Postgres hook with this URI:

```
pg-functions://postgres/public/before_user_created
```

Enable native Supabase Cloudflare Turnstile CAPTCHA protection and Auth rate limits as well. Require email confirmation, disable anonymous and unselected signup providers, and allow only the deployment's exact callback URL. Store secret values in the deployment/provider secret stores. Keep website authentication disabled until these settings are verified against the hosted project. Merely applying the migration does not enable the Auth hook or CAPTCHA.

The website consumes one Turnstile token through Siteverify to validate its expected hostname, action, freshness, and single use. It sends a separate fresh token to Supabase Auth for native CAPTCHA validation. The server issues a random, email-bound signup permit only after its Siteverify check succeeds. The Auth hook consumes the permit's SHA-256 hash atomically before allowing account creation. A missing, invalid, expired, replayed, or differently addressed permit is rejected. User metadata transports this one-use bearer proof; metadata fields never grant protected access or credits.

## Database contract

- `issue_signup_permit(p_email, p_permit_hash)`: service role only; stores a five-minute proof after the server's successful Siteverify check.
- `before_user_created(event)`: Auth administrator only; supported signup hook that requires and consumes the proof.
- `get_auth_context()`: authenticated callers only; returns current `user_id`, `session_id`, `email_confirmed`, `verification`, and `credits`, or SQL `null` for a missing, mismatched, expired, anonymous, or banned session. Credits are reported as zero unless the current email is confirmed and that exact session is verified; this does not modify the stored balance.
- `begin_session_verification()`: authenticated callers only; returns the new attempt UUID as text, or SQL `null` when verification cannot start.
- `finish_session_verification(p_user_id, p_session_id, p_attempt_id, p_success)`: service role only; returns `true` only when access was granted. A failure returns `false` and persists terminal denial, including when the same attempt's success committed first.
- `revoke_current_session()`: authenticated callers only; binds to the JWT subject and session ID and persists terminal application denial. The Next.js handler also calls supported Supabase Auth `signOut({ scope: "local" })` to remove the relevant Auth session and revoke refresh tokens.
- `consume_auth_rate_limit(p_key, p_limit, p_window_seconds)`: service role only; uses an atomic PostgreSQL upsert for shared counters. It deletes stale counters only after their rate-limit window has been expired for more than 24 hours, using a timestamp index to bound the cleanup scan.

Every public RPC is `SECURITY INVOKER`. Privileged implementations live in the unexposed `private` schema with fixed empty search paths and explicit execute grants. Authenticated helper functions always bind to `auth.uid()` and the current JWT's session ID; no caller-supplied identity authorizes them.

`public.video_credit_accounts` gives every newly inserted Auth user exactly zero video credits, including users created outside website routes. Existing users receive a zero balance when the migration first creates this table. No signup bonus, free allocation, or metadata-based grant exists. Users have no balance insert or update privileges. Reading their own balance requires current email confirmation, a live `auth.sessions` row, and a verified record for that exact session.

Future protected tables must enforce ownership and `private.is_verified_session()` in their RLS policies. Future protected Next.js operations must call `requireProtectedSession` before performing work. Verification is per session: a different login starts pending, and a failed session cannot recover by refreshing its JWT. The user must sign in again to create a new session.

## Executable regression checks

The isolated test dependency is pinned in `tests/package.json` and its lockfile. It does not change the application dependency tree.

```sh
npm ci --prefix supabase/tests
npm test --prefix supabase/tests
```

Alternatively, point `PGLITE_MODULE` at an already installed PGlite `dist/index.js` and run `node supabase/tests/run-regression.mjs` from the app directory. The suite creates an in-memory PostgreSQL database, models the Auth columns this migration reads, applies the real migration, and executes SQL assertions under the actual `anon`, `authenticated`, `service_role`, and `supabase_auth_admin` roles.

Assertions cover grants and RLS, the exact backend JSON contract, default zero credits, metadata forgery, ownership, old JWT claims after revocation/logout, email/session checks, terminal failure in both success/failure orderings, permit lifecycle, and shared rate limits. The regression transaction rolls back and the in-memory runtime is closed.

These checks execute PostgreSQL behavior; the fixture is not Supabase Auth. Hosted CAPTCHA enforcement, email delivery, signed JWT issuance, actual concurrent PostgreSQL connections, hosted Auth configuration, and provider security advisors require separate staging verification. Never treat this suite as evidence that those hosted checks passed.

## Rollback boundary

Keep authentication disabled while reverting a staging deployment. Do not drop these tables or remove verification checks while an auth-enabled deployment still accepts traffic. Removing a terminal denial while an old access token remains valid can restore access. Use the staging project's backup and an intentional forward migration for database recovery; do not apply these rollback steps to the unrelated Lucas project.
