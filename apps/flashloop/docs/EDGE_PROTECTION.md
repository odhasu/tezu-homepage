# Edge protection implementation and status

Updated: 4 November 2026.

## Status and decisions

Application changes are local to `apps/flashloop`. The finished homepage, assets, existing deployed runtime, unrelated applications, and newer deployment checkout are preserved. No DNS, zone, subscription, Vercel deployment, Supabase configuration, or hosted migration was changed by this milestone. [Cloudflare setup](CLOUDFLARE_SETUP.md) records provider inventory and the operational completion gate.

The user selected **two successful account creations per IP per rolling four days (96 hours / 345600 seconds)**. Fresh CAPTCHA tokens never reset this quota. Shared home/office/carrier IPs share the cap, and IP rotation means this is not a two-accounts-per-person guarantee. This quota is implemented locally and has not been applied to the hosted database. The user confirmed they do not yet own a domain; current staging stays unchanged.

6 November Google sign-in addition: existing-account OAuth starts use a separate **10/IP/600-seconds** attempt budget and the same protected runtime boundary. The existing new-user hook is unchanged, preserving the successful-creation quota; unknown Google accounts cannot create users. Google authentication and provider-verified email do not satisfy the separate per-session Turnstile gate. See [AUTH.md](AUTH.md#google-sign-in) for disabled flags, provider setup, native linking behavior and verification limits.

The low-overhead recommendation is Cloudflare's Free zone plan for combined burst filtering, a request-header transform for origin proof, and existing PostgreSQL for authoritative account limits. It needs no Worker or hosting migration. The available zone plan cannot be verified until an owned domain is selected and a zone exists. Edge thresholds remain proposals awaiting agreement.

## Implemented application boundary

- Every Vercel runtime requires an exact HTTPS custom `AUTH_ORIGIN` host and a server-only `EDGE_ORIGIN_SECRET`. Vercel enforcement cannot be disabled by the local opt-in flag. Missing configuration returns 503; missing/incorrect proof or host returns 403. Direct `.vercel.app` hosts are denied. The timing-safe comparison never returns the secret.
- Cloudflare must overwrite `x-flashloop-edge-key` for every request to that host. A public Cloudflare-looking header, `Origin`, forwarding header, or host alone grants nothing. `CF-Connecting-IP` is read only after proof validation and IP parsing. IPv6 text is normalized.
- Next.js Proxy covers all paths, including assets and callbacks. Auth, checkout, ownership, account, and generation handlers repeat the boundary. The account Server Component also checks origin headers. Next.js may canonicalize a trailing slash with a 308 before Proxy; the canonical request is still denied without proof.
- The existing signup/signin attempt budgets stay **20/IP/600 seconds** and **5/normalized email/600 seconds**. Session verification uses **5/account/600 seconds**, covering every session of that account. This replaces the narrower session counter and avoids an extra database request; the existing per-session verification state and revocation checks remain in place.
- Checkout derives its subject from the live verified session and uses **5/account/600 seconds**. Different accounts sharing an IP have separate checkout budgets. The sixth attempt is 429. Allowed attempts still return **503: checkout unavailable**. No payment session, payment request, credit grant, or entitlement mutation occurs.
- Successful signup uses the service-only `issue_signup_permit_for_ip` RPC with a separate stable HMAC of the trusted IP. The native Before User Created hook marks an email-bound, five-minute permit as claimed once. An `auth.users` AFTER INSERT trigger consumes the claim and locks the IP quota row in the same account-creation transaction. It retains at most two timestamps within the trailing 96 hours; account deletion cannot erase them. Failed CAPTCHA, unused permits, and rolled-back account inserts consume no creation slot. The early check returns 429 with exact remaining seconds. A failure-only read of `get_signup_ip_quota` also maps racing trigger denials to 429 without parsing hidden Auth errors. This adds no network call to successful signup.
- Trusted administrative provisioning without a presented permit is outside the public signup quota; no public API grants that capability. The native Auth hook must remain enabled because it rejects public signup without a valid permit. A presented invalid/unclaimed permit is rejected even on account insertion.
- Counters remain shared PostgreSQL state, using the existing service-only atomic limiter; there is no process-local quota fallback. Counter failures deny access. A boolean RPC cannot report exact remaining time, so 429 and explicit temporary limiter/checkout 503 responses conservatively advertise `Retry-After: 600`. A blocked attempt does not extend the database window.
- Every Supabase HTTP request has an eight-second transport deadline while preserving caller cancellation. Siteverify retains its eight-second deadline. These are per-call deadlines, not a claim of an eight-second total workflow: sequential provider calls and cleanup can take longer.
- Protected responses and handled errors remain `private, no-store`. No machine callback exemption exists. PKCE email callback remains protected; Whop remains deferred. Concurrent storage work added an Inngest route, which must retain the same origin guard and its own SDK signature checks; this milestone did not add an edge exemption for it. Native Supabase CAPTCHA, signup permits, confirmed email, session revocation, provider rate limits, and RLS remain mandatory on the direct provider endpoint.

## Verification

Executed on Node.js 24.22.2 and installed Next.js 16.4.5:

- Initial local verification passed 171 auth/client/origin/checkout/provider-cancellation/ownership/entitlement unit tests. Controlled clients verify application decisions, not hosted authorization. Scoped ESLint passed for all changed source.
- 55 quota SQL assertions and 69 auth SQL assertions passed with all five current local migrations in PGlite. Quota checks cover the two-creation cap, exact rolling expiry, claim replay, rollback, deletion resistance, distinct IPs, grants, and bounded cleanup. PGlite does not prove simultaneous independent PostgreSQL connections or hosted GoTrue hook/insert integration.
- The built Next.js server passed 22 origin-boundary HTTP checks, including canonical/forged hosts, forged Cloudflare headers, callback paths, static assets, and absence of the origin secret from response headers/bodies. Auth was disabled during that smoke test. It proves the built local network boundary, not a live Cloudflare/Vercel route or account quota.
- Three hosted direct-Supabase negative checks passed: missing CAPTCHA and invalid CAPTCHA each returned `captcha_failed`; anonymous permit issuance returned `42501`. No users, fixtures, or settings changed. Credential values stayed in process memory. Hosted configuration readback failed with sanitized `ConfigDiffFailed`; no new configuration-readback claim is made.
- The final combined source also passed the static GitHub Pages build and all 85 destination checks. The static export excluded runtime APIs, the protected account page, and Proxy. The normal runtime build was restored afterward. No artifact was published.
- During concurrent storage work, an intermediate full check stopped at three TypeScript errors in `src/lib/storage/r2.ts`; ownership rollback and generation SQL also failed while their neighboring files changed. Those changes were preserved. Subsequent verification passed after that work progressed: full app `npm run check` (lint, strict TypeScript, all current unit suites including storage, 93-asset audit, and runtime production build), 103 ownership SQL assertions plus its explicitly historical rollback checks, and 71 generation SQL assertions. This records the final successful checks without treating the intermediate failures as unresolved.

Local controlled clients do not prove hosted Auth, distributed concurrency, Cloudflare propagation, Vercel header handling, or production security.

## Missing setup

The hosted quota migration and live native Auth integration tests; a domain the user owns, with production and staging hostnames; Cloudflare zone and plan; agreed edge thresholds; production Vercel project selection; separate origin secrets and overwrite transforms; exact custom-domain DNS/certificates and PKCE/Turnstile settings; private-route cache bypass rules; protection or removal of historical unguarded deployments; live signup bursts, edge retry recovery, shared-IP and direct-origin checks. SMTP/public signup restrictions from [AUTH.md](AUTH.md) remain relevant. The future Whop contract is still deferred.

Do not deploy this guarded build onto the current staging alias as an unplanned cutover: its existing `vercel.app` configuration deliberately fails the new guard. Complete the [rollout runbook](CLOUDFLARE_SETUP.md) first, or intentionally close the service during setup. Keep the static [GitHub Pages preview](https://odhasu.github.io/tezu-homepage/flashloop/blue/) separate from runtime security claims.

## Quota rollout and maintenance

The local migration is `20261104210943_signup_ip_rolling_quota.sql` (SHA-256 `111a7734d4d7ce15fe49e489a30de24e59c8e45601d9390e1173ec837cc921a7`). It deliberately closes the old two-argument permit issuer. Do not apply it against the existing staging release: that release still calls the legacy issuer. Coordinate the new application, trusted IP extraction, HMAC secret, custom domain, and migration in a planned cutover. Reconcile the earlier local/hosted auth migration timestamp difference documented in [OWNERSHIP.md](OWNERSHIP.md) before changing deployment methods. Never blindly replay all local migrations against staging.

`SIGNUP_IP_HASH_SECRET` must be separate from the origin-header secret and identical across instances using the same quota. Keep it stable. Replacing it would change IP identities and reset their cap; any rotation must preserve the old identity mapping for at least 96 hours. Plaintext IP addresses are not written to the new permit/quota columns.

The private service-only `cleanup_signup_security(500)` function deletes at most 500 expired permits and 500 wholly expired quota rows per call. It uses indexed batches and `SKIP LOCKED` outside signup. Schedule or run it through trusted maintenance before enabling general signup; no Inngest schedule is created here. Do not truncate active quota history as a cleanup or rollback shortcut.

Repeatable checks:

```sh
npm run check
npm run test:edge:runtime
npm run test:auth:database
npm run test:signup:database
# Optional live negative-only check; provide the trusted authenticated CLI path.
SUPABASE_CLI_BIN=/absolute/path/to/supabase npm run test:edge:provider
```

The provider, website, and ownership fixture runners now share [administrative-fixture.mjs](../scripts/administrative-fixture.mjs). It detects the new schema with a read-only quota-status probe using a synthetic per-test hash. New-schema fixtures deliberately use trusted administrative provisioning without a signup permit; that endpoint does not execute the public signup hook. Only the exact missing-RPC `PGRST202` response selects the legacy permit path. Permission errors, quota denials, network failures, malformed data, and partial migration states fail closed with sanitized errors. This is fixture compatibility, not a production fallback.

The updated `npm run test:auth` passed all 86 tests, including 21 new fixture contracts. All four changed helper/runner scripts passed Node.js syntax checks. No updated hosted runner was executed and no fixture user, provider setting, or hosted schema was changed in this continuation. The website runner still targets the historical staging alias; retarget it to the user's approved custom staging hostname as part of cutover. Historical hosted passing results remain historical, and administrative fixtures are not evidence of public signup, native hook execution, or the new IP quota. The negative-only provider script remains compatible with the current deployed schema.

## Completion audit after local preparation

The goal is not complete. Rollout is blocked on an owned domain and the resulting provider setup. This condition remained unchanged across the original implementation turn and two automatic continuations. The final read-only audit again returned Cloudflare `total_count=0` across complete zone pagination and exactly one Vercel hostname, `kumi-staging.vercel.app`, with no next page. The user has confirmed they do not own a domain yet. No running deployment or external job is being awaited. Remaining DNS, edge-rule, guarded-release, and live acceptance work cannot proceed without that user choice and external setup; do not purchase a domain, guess a hostname, or replace the required live evidence with more local checks.

| Required outcome | Current authoritative evidence | Result |
| --- | --- | --- |
| Chosen production and staging domains behind Cloudflare, with Vercel hosting | No owned domain or Cloudflare zone; staging has no custom hostname | Not configured |
| Plan-supported edge limits with explicit windows and thresholds | Free-compatible combined 20 requests/IP/10 seconds and 10-second block are documented proposals; no zone rules exist | Not deployed or live-tested |
| Server-side per-account limits and two successful signups/IP/96 hours | Local handlers, service-only RPCs, insertion trigger, and executed tests | Implemented locally; hosted migration and integration pending |
| Direct origins cannot bypass controls | Local all-path Proxy and repeated handler checks; built-server negative checks | Current/historical Vercel deployments still need coordinated protection and live probes |
| Native Supabase protections remain effective | Three negative requests verified native CAPTCHA and denied anonymous permit issuance on current staging | Negative paths verified; new hosted quota integration pending |
| Shared-IP users and verified callbacks follow deliberate rules | Separate account counters, shared signup cap, no edge exemptions; guarded Inngest route | Local evidence only; live network and signed callback checks pending |
| Unavailable Whop checkout never accepts payment or grants entitlement | Local checkout always fails closed; no Whop contract or payment calls | Implemented; Whop remains deferred |
| DNS, rules, origin handling, dashboard work, and actual test scope documented | This status file and [Cloudflare runbook](CLOUDFLARE_SETUP.md) | Documented |

Do not mark this goal complete from green local checks. Activation requires a domain the user chooses, provider configuration, a coordinated migration/release, and the live checks listed in the runbook. Domain registration or paid provisioning has not been authorized or performed.
