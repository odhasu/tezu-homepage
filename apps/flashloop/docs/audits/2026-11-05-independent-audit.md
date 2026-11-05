# Independent Flashloop audit — 5 November 2026

## Scope and conclusion

The request was to review chats, test bugs, explain whole-site analytics, and assess whether plugins were secure and had completed their work. Available context identifies Flashloop as the likely target. Flashloop-versus-Tezu scope confirmation was requested and remained unanswered during this read-only first pass. No application code, dependencies, cloud settings, permissions, accounts, payments, generations, or deployment were changed. Only this audit note was added. Another chat was actively working on telemetry; its files were not edited.

**Conclusion: local checks pass, but production readiness and end-to-end plugin completion are not established.** This is not a penetration-test certificate or an exhaustive review of every conversation/plugin in the account.

## History and source reviewed

Listed recent and historical accessible Codex threads. Read available message histories for:
- `Add Sentry, PostHog, and HTTP caching`
- `Add durable Inngest generation jobs`
- `Secure private uploads and outputs`
- `Add shared credits spend caps`
- `Configure Cloudflare edge protection` (latest turn concerned domain naming, not the entire earlier security conversation)
- `Audit website bugs and analytics` (latest failed continuation turns)

Reviewed workspace documentation, Flashloop instructions, dependency manifests, relevant analytics/generation/runtime code, and current implementation/setup notes. Historical claims in other chats are not fresh test results. Unrelated personal chats and the entire older/archived history were not read. See [implementation map](../README.md), [analytics](../ANALYTICS.md), [observability](../OBSERVABILITY.md), [wizard status](../POSTHOG_WIZARD.md), [jobs](../JOBS.md), [storage](../STORAGE.md), and [edge setup](../CLOUDFLARE_SETUP.md).

## Fresh local verification

Node.js 24.22.1 was used.

| Check | Result | Boundary |
| --- | --- | --- |
| `npm run lint` | Passed | Flashloop only |
| `node --test tests/*.test.cjs tests/*.test.mjs` | 380 passed, zero failed/skipped | Local tests; not production acceptance |
| `npm run audit:assets` | 93 files, 54,800,445 bytes verified | Local assets |
| `npm run typecheck` | Passed | Isolated source copy |
| `npm run build` | Passed | Isolated copy, installed dependencies copied, no secret env files |
| `npm run test:jobs:runtime` | 8 checks passed | Real local production server; disabled/missing-provider gates |
| `npm run test:storage:runtime` | 5 checks passed | Real local production server; disabled storage gates |
| `npm run test:cache:runtime` | 28 checks passed | Local private/public response caching; no real two-account/browser/CDN acceptance |
| `npm audit --json` | 14 affected package entries: 2 high, 12 moderate | Dependency advisories, not 14 independent proven exploits |
| `npm audit --omit=dev --json` | 7 entries: 2 high, 5 moderate | Installed production dependency graph |

The first isolated build attempt failed because Turbopack disallows resolving a symlinked dependency tree outside its root. Replacing only the temporary copy's symlink with a filesystem-cloned dependency tree resolved this harness issue; the subsequent normal build passed. No source/config change was needed. The authoring `.next` directory and the newer deployment checkout were not replaced.

Temporary detailed logs: `/tmp/flashloop-independent-audit-tests.log`, `/tmp/flashloop-independent-build.log`, `/tmp/flashloop-independent-npm-audit.json`, `/tmp/flashloop-independent-prod-audit.json`. These are ephemeral, not persistent evidence storage.

## Findings and priorities

### P1 — dependency security remediation before enabling jobs

Installed `inngest@4.26.2` depends on `zod@3.25.76`. The audit flags Zod memory exhaustion when validating oversized constrained collections; Inngest inherits the high-severity dependency finding. Installed `glob@10.5.0` and `minimatch@9.0.9` also appear in Inngest's telemetry dependency chain. `minimatch@10.2.6` affects the development lint chain. Sentry's separate `glob@14.0.3` / `minimatch@11.0.4` copies are not those flagged copies.

Advisories checked against GitHub's reviewed advisory pages:
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 — Zod, affected `<4.6.6`.
- https://github.com/advisories/GHSA-g3hv-75wg-m249 — minimatch, affected `>=7.0.0 <11.0.1`.
- https://github.com/advisories/GHSA-3g3m-2fjr-6pw4 — glob, affected `>=9.0.0 <=14.0.1`.

No successful exploit was demonstrated. Reachability and SDK compatibility still require investigation. Do not run `npm audit fix --force`: its proposed Inngest 0.3.0 / eslint-config-next 15.5.29 downgrades would be inappropriate for this application. Do not force Zod 4 over an SDK's Zod 3 dependency without compatibility tests. Remediate in an isolated dependency-change task and rerun all acceptance checks.

### P1 — current analytics is not whole-site product analytics

`src/lib/analytics/server.ts:68` uses `properties.request_id` as PostHog `distinct_id`. `capturePageview` creates a fresh UUID per pageview (line 87). The custom events and fixed page enums intentionally avoid persistent visitor identification, referrers, full URLs, replay, prompts, and personal media. This is privacy-minimal event/outcome counting, not reliable unique visitor, returning-user, session, attribution, retention, or signup-to-generation funnel measurement. This is an explicit product-scope gap, not an instruction to silently broaden tracking.

`analyticsConfig` returns null for static export and missing/unapproved configuration. The current GitHub Pages artifact therefore cannot run this Next.js server-side analytics route. Normal GitHub Pages hosting is static; using a separately configured backend/ingestion service would be a different design requiring consent and destination decisions. No received PostHog event, selected project, custom dashboard, or live consent acceptance was verified in this audit. The other telemetry chat's incomplete wizard/authentication remains unresolved, not implicitly completed here.

### P1 — backend work is not equivalent to deployed acceptance

Vercel read-only lookup confirmed `kumi-staging` still references READY deployment `dpl_7p34A3RfdZwz5x1v7CnUznf767RB`. Local jobs/storage/telemetry additions cannot be assumed deployed there. Cloudflare authenticated account/zone listing returned zero zones across complete pagination. This connection does not currently demonstrate a configured custom-domain WAF/rate-limit/origin-protection path. The fresh R2 listing attempt returned `INVALID_ARGUMENT`, so current bucket/activation state was not verified; earlier storage notes report activation pending.

Current hosted Supabase table inventory contains accounts, projects, jobs, uploads, outputs, video_credit_accounts, and three private Auth tables. It does not demonstrate that the newer generation-entitlement/private-object/durable-job migration sets have been applied. No migrations were applied during this audit.

### P2 — Supabase password security warning

Fresh Supabase Security Advisor reported `Leaked Password Protection Disabled`. Review availability/plan implications and enable through an approved configuration change; no billing or setting change was made.

Remediation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

All nine returned public/private application tables had RLS enabled. Three private Auth tables had no policies; explicit table grants to anon/authenticated/PUBLIC were absent. This is consistent with an intentionally inaccessible private implementation, not evidence that RLS should be disabled or permissive policies added. Metadata inspection alone does not prove every policy/function is safe.

RLS reference: https://supabase.com/docs/guides/database/postgres/row-level-security

### P2 — navigation remains a separate-demo boundary

`src/lib/links.ts:3` routes many product destinations to `https://odhasu.github.io/flashloop-clone/blue/`, not the new application's own backend. Fresh HTTP GET checks returned 200 for the current public homepage and the referenced auth, video-create, pricing, privacy, and MCP pages. They are not confirmed broken links; HTTP 200 is also not proof of working account creation, payment, generation, or MCP connection. Local Auth uses its own URL only when the explicit public Auth flag is enabled. Preserve this intentional clone behavior until real routing is approved.

## Published browser checks

Target: https://odhasu.github.io/tezu-homepage/flashloop/blue/

Verified model menu opens, selecting Seedance 2.5 changes the displayed choice, Image tab switches, and mobile menu opens/closes. Sampled browser console returned no warning/error entries. Initial completed-image inspection reported no broken completed images. Videos had no media error code but were unloaded; video playback is **not proven**. No uploads or generation submissions were made.

A requested 390-by-844 viewport resulted in an observed 260 CSS-pixel width in this browser backend. Mobile menu checks apply to that observed width; precise 390-pixel acceptance was not established. Temporary viewport override was reset. This was a smoke test, not exhaustive responsive/accessibility/performance QA.

## Plugin connection and permission findings

| Integration | Fresh observation | What remains unproven |
| --- | --- | --- |
| Supabase | Project listing, security advisor, read-only RLS/grant metadata queries worked | Full hosted policy isolation and deployed application flows |
| Vercel | Team/project discovery worked; staging release metadata inspected | Deployment of latest code and real browser/CDN isolation |
| Cloudflare | Account and complete zone listing worked; zero zones; R2 call failed | R2 privacy/expiry, WAF/rate limits, origin blocking |
| PostHog | Skill discovery and documentation worked; business-knowledge call unavailable | Selected environment/project and actual event delivery/dashboard accuracy |
| Inngest | `list_envs` returned Unknown tool | Authenticated cloud environment, app sync, durable cloud execution |
| Sentry | Local read-only skill exists; `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` absent as environment booleans | Authenticated project inspection and received controlled error |

Plugin Management recognizes Supabase, PostHog, Vercel, and Cloudflare and reports `Use my default` / `Allow low-risk actions` for each. It reports Sentry and Inngest as not installed, despite the local Sentry skill and an advertised-but-failing Inngest tool. These are inconsistent discovery surfaces; do not infer successful connection or blanket absence from one result. No permissions were changed. These app-level controls are not an audit of provider OAuth scopes, token grants, vendor code, or supply-chain integrity. A stricter ask-before-writes policy for infrastructure plugins is a proposal, not an applied setting.

Whop and the website's live ChatGPT/MCP integration remain deferred under the existing project requirements. No payment/credit-grant or live MCP completion is claimed.

## Analytics destination and proposed dashboard

Recommended owner interface: selected PostHog project's Web Analytics plus custom product dashboards. Error diagnostics belong in Sentry; authoritative credits/costs in the PostgreSQL ledger; job execution in Inngest; hosting/edge health in Vercel/Cloudflare. A public visitor should not receive an admin analytics dashboard or its privileged query credentials.

Recommended dashboard after consent/data-region/project decisions and instrumentation upgrades:
1. Traffic: consented visitors, views, source/campaign, landing page, device, web performance.
2. Activation: landing -> signup -> verification -> first successful generation.
3. Product: completed/failed jobs, retries, queue time, latency, retention.
4. Business: ledger-reconciled provider spend, credit use, cap rejections; revenue only when payments exist.
5. Reliability: error rates, failed job alerts, availability.

PostHog documentation was checked through its connected docs tool, not inferred from plugin installation: https://posthog.com/docs/web-analytics/dashboard and https://posthog.com/docs/product-analytics/dashboards . Whole-site measurement needs every intended first-party page/application instrumented and an approved correlation policy. Rejected-consent visitors must not be silently tracked; analytics is not a complete count of every human.

## Next acceptance work

Confirm target scope before dependent fixes. Then remediate dependency findings safely; select separate staging/production telemetry projects, region, privacy/retention policy and alerts; decide counts-only versus consented visitor/funnel tracking; configure owned staging domain/Cloudflare origin boundary and R2; repair/authorize Sentry and Inngest access; deploy a coordinated migration/configuration release. Finally run real two-account ownership/cache tests, CAPTCHA/email verification, private upload expiry/cross-account tests, provider duplicate/restart/billing tests, controlled Sentry delivery and consent/payload checks in PostHog. Do not replace those with passing disabled/mock tests.
