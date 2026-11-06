# Signup and session verification database

Current hosted Auth and ownership setup and verification are recorded in [AUTH.md](../docs/AUTH.md) and [OWNERSHIP.md](../docs/OWNERSHIP.md). The entitlement migration is local-only and has not been applied to a hosted tenant. The setup instructions below describe requirements rather than claiming hosted entitlement setup is complete.

This directory contains the database portion of the Flashloop signup, verification, ownership, and entitlement flows. It does not connect to or mutate a hosted project by itself. The entitlement migration was created with the discovered pinned Supabase CLI v3.0.0 and executed only in disposable local PostgreSQL runtimes for regression checks.

## Required hosted setup

Apply the migration only to the dedicated `kumi` project after confirming its project reference. Enable the supported Supabase **Before User Created** Postgres hook with this URI:

```
pg-functions://postgres/public/before_user_created
```

Enable native Supabase Cloudflare Turnstile CAPTCHA protection and Auth rate limits as well. Require email confirmation, disable anonymous and unselected signup providers, and allow only the deployment's exact callback URL. Store secret values in the deployment/provider secret stores. Keep website authentication disabled until these settings are verified against the hosted project. Merely applying the migration does not enable the Auth hook or CAPTCHA.

The website consumes one Turnstile token through Siteverify to validate its expected hostname, action, freshness, and single use. It sends a separate fresh token to Supabase Auth for native CAPTCHA validation. The server issues a random, email-bound signup permit only after its Siteverify check succeeds. The Auth hook consumes the permit's SHA-256 hash atomically before allowing account creation. A missing, invalid, expired, replayed, or differently addressed permit is rejected. User metadata transports this one-use bearer proof; metadata fields never grant protected access or credits.

Google is an optional sign-in method for existing accounts, with setup and observed provider state in [AUTH.md](../docs/AUTH.md#google-sign-in). Its provider must be configured separately; do not remove or relax `before_user_created` to enable it. The hook still denies unknown Google accounts, so new users create an email account under the existing IP quota first. Supabase may link an existing account by a native verified Google email; this still leaves a fresh application session pending until Turnstile verification. No Google signup migration is included.

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

## Shared generation entitlement contract

The fail-closed CLI-created migration is `20261104210635_generation_entitlements.sql`. See [SPEND_CAPS.md](../docs/SPEND_CAPS.md) for the current service/Route Handler contract, atomic dispatch claim, accounting across days, administrative RPCs, configuration order, rollback boundary, and verification limits. It is local-only and has not been applied to the hosted tenant.

The database owns request fingerprints, fixed provider profiles, account entitlements, zero-credit defaults, transactional holds, job limits, and daily spend counters. Only the service role can claim dispatch or record provider results. Unknown outcomes retain funds and cannot be released. Known cost overruns are counted immediately and disable generation. Financial foreign keys prevent account/project/job deletion from erasing the ledger.

## Executable regression checks

### Whop subscription billing foundation

`20261105164609_whop_subscription_billing.sql` was created with the installed Supabase CLI 3.0.0 `migration new` command after inspecting command help. It is local and unapplied. It seeds no commercial catalog and leaves billing disabled. Billing authorization denies generation until an active, current, verified paid period exists; operator account enablement, the generation kill switch, provider pricing and all spend caps remain separate requirements.

The private forced-RLS tables retain environment-scoped immutable provider identity, one-time OAuth state hashes, permanent checkout creation claims, minimal verified webhook receipts and activation evidence, memberships, paid collections, expiring credit buckets and reservation allocations. No raw provider payload, signature, OAuth token, PKCE verifier or signed checkout URL belongs in these tables. Public wrappers have named arguments and service-only execution. Generic service-role credit updates are revoked.

Only a signature-verified `membership.activated` receipt carrying the matching membership/paid-period evidence can support a first or recurring paid grant. Payment timestamps alone cannot identify a historical invoice period. Grant uniqueness applies both to the provider payment and to the membership period. Unknown external purchases do not auto-link. Ambiguous invoices, upgrades and proration cannot mint credits. Refund/dispute review persists, denies new reservations/dispatch claims and preserves all existing monetary holds and settlement capabilities. Expiry removes only unused bucket credits; an unclaimed release restores only allocations that have not expired. Existing manually funded credits are preserved without a new automatic grant.

Local verification on 5 November 2026:

- `node supabase/tests/run-billing-regression.mjs`: **57 assertions passed** against all seven real migrations in disposable PGlite. Coverage includes default denial, no seeded commercial values, explicit named RPC arguments, live session/identity binding, one-time OAuth proof, permanent checkout claims, immutable event replay, signed period evidence, unique payment/cycle grants, cancellation, past-due denial, out-of-order snapshots, no proration grants, bucket consumption/expiry/release, refund hold, preserved financial reservations, post-revocation settlement, forced RLS, narrow credit grants and guarded empty rollback/reapplication.
- `node supabase/tests/run-billing-concurrency.mjs`: **20 assertions passed** against disposable native PostgreSQL **17.11** with independent connections. Twenty-way races covered checkout creation, duplicate verified receipts, paid grants, distinct webhook IDs for the same payment, bucket-funded generation reservations, and refund versus paid-dispatch claim. The runner binds loopback, uses a private temporary socket/data directory and always closes connections, stops its server and removes its data.
- Historical regression runners intentionally stop at the six-migration milestone before billing, retaining their original explicit test funding without weakening the new production gate. Auth **69**, ownership **103**, generation **76**, jobs **51** plus backfill/rollback, storage **51**, signup quota **55**, and native generation/jobs/storage **42/31/23** assertions all passed again. The billing suite separately exercises the combined seven-migration state, including actual generation reservation/claim/settlement integration.

These tests use synthetic Auth/provider facts. They do not prove hosted Supabase Auth/RLS, actual Whop signature/payment semantics, merchant configuration, browser/CDN behavior or a deployment. No hosted migration, merchant charge/refund, provider operation or deployment was performed. The billing rollback refuses retained identity, checkout, receipt, grant or allocation evidence; populated installations need forward recovery.

### Durable generation delivery and settlement

`20261105124533_durable_generation_jobs.sql` extends the reservation transaction with a durable outbox, immutable provider-job bindings, permanent callback event receipts, and a live execution concurrency check. All new tables live in `private` with forced RLS; RPC wrappers are service-only `SECURITY INVOKER`. Callback identity lookup, job transition, ledger settlement, and receipt insertion share one transaction. Unknown jobs cannot mutate accounting. See [JOBS.md](../docs/JOBS.md) for contracts, setup, and actual verification limits. No hosted jobs migration was applied.

Run `npm run test:jobs --prefix supabase/tests` for 51 SQL assertions, four populated-schema backfill assertions, and eight guarded rollback/restoration/reapplication assertions. Run `npm run test:jobs:concurrency --prefix supabase/tests` for 31 independent-connection assertions against a disposable native PostgreSQL 17.11 instance. The guarded rollback refuses retained delivery/binding/replay records or outstanding financial obligations; populated deployments require a reviewed forward recovery plan. Never erase receipts or funds to force rollback.

### Private R2 object authority

`20261104211046_private_project_objects.sql` is a local, unapplied migration. It adds `public.project_objects` as the authoritative private upload/output metadata table. Earlier `uploads` and `outputs` rows remain metadata only and must never authorize an R2 signature. Object IDs and staging/sealed keys are generated in PostgreSQL from immutable owner and project IDs. Authenticated users have only a verified-owner SELECT policy; reservation and deletion use narrow user RPCs, while completion, output reservation, policy configuration, and cleanup use service-only RPCs. Public wrappers are SECURITY INVOKER; privileged implementations have an empty search path in the unexposed private schema.

The private singleton policy starts disabled with no limits, lifetime, retention, or MIME choices. `configure_storage_policy` requires explicit values before enabling: upload URL lifetime 30–900 seconds, download URL lifetime 1–900 seconds, maximum upload at most 20 MiB, an account byte cap, retention 1–365 days, and a nonempty subset of PNG, JPEG, and WebP MIME types. These bounds are implementation safeguards, not selected production settings. Service-role credentials cannot write object tables directly. The policy does not configure or verify an R2 account, bucket, credentials, CORS, public-access setting, or provider destination.

Reservations lock the owned project and serialize by owner before charging the shared byte cap. Each reservation charges twice its declared size for staging plus sealed copies. The declared `byte_size` remains immutable; only verified server completion can set `verified_byte_size`, ETag, and ready state. Output reservation and first completion require the exact persisted running job/project/owner tuple. Pending or expired metadata cannot authorize generation or downloads; actual R2 validation remains the server adapter's responsibility.

Deleting an object, project, job, or Auth user inserts an exact-key record into `private.storage_cleanup` in the same transaction. The outbox has no foreign key to the removed owner or project. Charges remain until the trusted worker has deleted both keys and acknowledges that row. Cleanup cannot run or be acknowledged until the upload URL deadline plus 60 seconds, preventing a still-valid upload URL from recreating a key after final cleanup. Retention and abandoned-upload sweeps also delete metadata through this outbox. No prefix deletion or caller-selected key is supported.

Run `npm run test:storage --prefix supabase/tests` from the Flashloop app. Actual local verification on 4 November 2026 passed 51 PGlite assertions with all five current migrations, plus populated-metadata and pending-cleanup rollback refusal, empty rollback, parent RLS preservation, and reapplication. The historical ownership runner also passed 103 assertions, its catalog audit, and rollback in a separate historical-schema database. These checks execute PostgreSQL roles, RLS, grants, constraints, quota decisions, and cleanup transactions; they do not prove hosted concurrency, live R2 privacy, signed-link expiry, upload verification, or production security. The guarded storage rollback refuses while object metadata or physical-cleanup records remain.

`node supabase/tests/run-storage-concurrency.mjs` additionally passed 23 assertions against a separate disposable native PostgreSQL 17.11 cluster using independent connections. Twenty concurrent mixed upload/output reservations stopped at the account cap; an uncommitted project cascade could not create a quota gap; deleted metadata charges moved atomically into the durable outbox; other accounts remained untouched. Account deletion blocked a competing reservation until it failed, and output completion held the running-job lock until its verified state committed. A later terminal job state rejected stale output completion. The runner uses its own temporary directory and loopback port, reads no hosted credentials, stops its server, and removes its cluster afterward. This verifies local native PostgreSQL concurrency, not hosted Auth/RLS configuration, R2 behavior, provider execution, or production security.

The isolated test dependency is pinned in `tests/package.json` and its lockfile. It does not change the application dependency tree.

```sh
npm ci --prefix supabase/tests
npm test --prefix supabase/tests
npm run test:generation --prefix supabase/tests
npm run test:storage --prefix supabase/tests
npm run test:generation:concurrency --prefix supabase/tests
```

Alternatively, point `PGLITE_MODULE` at an already installed PGlite `dist/index.js` and run `node supabase/tests/run-regression.mjs` from the app directory. The suite creates an in-memory PostgreSQL database, models the Auth columns this migration reads, applies the real migration, and executes SQL assertions under the actual `anon`, `authenticated`, `service_role`, and `supabase_auth_admin` roles.

Assertions cover grants and RLS, the exact backend JSON contract, default zero credits, metadata forgery, ownership, old JWT claims after revocation/logout, email/session checks, terminal failure in both success/failure orderings, permit lifecycle, and shared rate limits. The regression transaction rolls back and the in-memory runtime is closed.

These checks execute PostgreSQL behavior; the fixture is not Supabase Auth. Hosted CAPTCHA enforcement, email delivery, signed JWT issuance, actual concurrent PostgreSQL connections, hosted Auth configuration, and provider security advisors require separate staging verification. Never treat this suite as evidence that those hosted checks passed.

## Rollback boundary

Keep authentication disabled while reverting a staging deployment. Do not drop these tables or remove verification checks while an auth-enabled deployment still accepts traffic. Removing a terminal denial while an old access token remains valid can restore access. Use the staging project's backup and an intentional forward migration for database recovery; do not apply these rollback steps to the unrelated Lucas project.

