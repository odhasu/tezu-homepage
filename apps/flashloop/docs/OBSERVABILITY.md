# Sentry, PostHog and HTTP caching

Updated: 5 November 2026. This milestone extends the existing independent Flashloop backend after its core routes and durable job states. The finished frontend, other applications, published GitHub Pages artifact and newer deployment checkout were preserved. Whop payments and a live ChatGPT/MCP connection remain deferred.

## Current state

The application has manual Sentry error and job tracing, consent-gated PostHog website/service-outcome analytics, and explicit HTTP cache boundaries. Both telemetry destinations are disabled without deliberate, valid environment configuration. No Sentry or PostHog project was provisioned, no telemetry credential was retrieved or written, no hosted telemetry event was sent, and no deployment or CDN rule was changed.

The owner still needs to select separate staging/production projects, data regions, the applicable consent/privacy policy, retention and access controls, and alert destinations. These decisions were requested in chat. They cannot be inferred from a local test or an unrelated connected PostHog project. Pending decisions do not authorize using production projects for staging.

The current names and disabled defaults are also listed in [the app environment example](../.env.example). Leave credentials blank there and install actual values only in the selected deployment's secret store.

See [ANALYTICS.md](ANALYTICS.md) for the PostHog event/consent/configuration contract and [CACHING.md](CACHING.md) for the browser/CDN/public-asset policies and deployment acceptance steps.

## Correlation and data minimization

`src/lib/observability/request.ts` wraps the runtime Auth, account, project, storage, generation, checkout and provider-callback routes. Every wrapped request generates a fresh UUID at the server boundary and returns it in `X-Request-ID` on a private/no-store response. Incoming request-ID and tracing headers never select that ID or grant access. The existing Auth, verified-session, ownership, RLS, quota and origin checks still execute on every request.

Successful generation reservations and authenticated provider callbacks supply only their database-produced generation-request/job UUIDs to telemetry. Those identifiers connect the HTTP request to subsequent job execution and settlement without retaining the prompt, request key, owner, provider job ID or media. Failed requests do not extract correlation from an error response. Each worker attempt gets its own fresh request UUID; the worker adds generation-request/job IDs only after loading and validating the persisted job context. Neither event-supplied owner data nor a caller's chosen UUID proves ownership.

HTTP operations are fixed enums: signup, signin, verification, authorization, generation and webhook. The email callback and second session verification use the verification operation. Events describe route outcomes and numeric HTTP status, not proof that email was delivered, a provider completed work, or media was stored. HTTP 401/403 also produce an authorization outcome; 402/429 produce a quota-rejection outcome. Requests rejected before the Route Handler at the edge/Proxy do not produce application analytics. Provider webhooks and background jobs have no browser consent by default, so no PostHog event is emitted for them without a current valid consent-bearing request.

Sentry manually traces generation execution/reconciliation, outbox publication and storage cleanup. Existing Inngest app identity, signatures, concurrency limits, permanent paid-operation claims and safe durable outputs are retained. Telemetry never retries application work, changes a reservation/settlement, authorizes a request or becomes a durable job payload. Job telemetry is flushed within a bounded timeout. HTTP analytics and flushing use Next.js `after` so they do not delay the response; delivery is best effort, not a durable audit ledger.

Only fixed operation names and validated operational UUIDs can leave through Sentry. Its hooks rebuild complete error/span payloads from allowlists after enrichment, remove attachments, and discard ambient request/user/body/URL/extra data. Raw caught exceptions are never passed to the reporter. Error text is a fixed operation failure, intentionally trading stack/provider diagnostic detail for a narrow privacy boundary. Browser Sentry, replay, automatic HTTP/database instrumentation, local variables, breadcrumbs, logs and propagated tracing baggage are not enabled. The Next.js framework-error hook ignores the raw error, request path and headers and generates independent safe correlation.

PostHog uses a server relay with exact fields and per-request anonymous IDs, no browser SDK or persistent visitor identity. It collects neither unique-person funnels nor media. See [ANALYTICS.md](ANALYTICS.md) for explicit consent, withdrawal, GPC/DNT, cookie expiry and policy-version behavior. Operational error monitoring has its own explicit privacy-approval gate; optional-analytics consent is not silently treated as approval for another processing purpose.

Application code has no raw diagnostic logger. Hosted Vercel/Cloudflare/Supabase/provider request logs, drains, error pages and access retention remain separate configuration boundaries: review query-string/header/body collection and scrubbing before rollout, especially email-confirmation codes and signed object URLs. Local application hooks cannot prove those external services redact data. Restrict operational IDs as pseudonymous data, define retention/deletion, and never attach credentials, cookies, tokens, prompts, files or signed URLs to alerts.

## Sentry configuration

Install values only in the selected deployment's secret/configuration store; do not commit them, paste them into chat or print them. The pinned server SDK is `@sentry/node` 11.11.0. There is no browser DSN or build-time auth token requirement for this implementation.

| Variable | Contract |
| --- | --- |
| `TELEMETRY_ENVIRONMENT` | Exactly `staging` or `production`; shared with PostHog, no fallback |
| `SENTRY_ENABLED` | Exactly `true` to enable server capture |
| `SENTRY_PRIVACY_APPROVED` | Exactly `true` only after approval of the monitoring purpose, region, retention and redaction boundary |
| `SENTRY_STAGING_DSN` / `SENTRY_PRODUCTION_DSN` | Selected environment's separate official HTTPS Sentry project DSN |
| `SENTRY_RELEASE` | A 7–64 character hexadecimal source commit identifier |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional number from 0 through 1; defaults to 1 in staging and 0.1 in production |
| `SENTRY_STAGING_PROBE` | Exactly `true` only for the explicit staging verification command |

The validator accepts official Sentry SaaS ingestion hosts and rejects credentials beyond the DSN public key, query parameters, arbitrary endpoints and malformed project IDs. It never falls back to the other environment. When both DSNs are present, the same host/project is rejected even if DSN public keys differ. Install only the selected project's configuration and independently verify the correct project and region in Sentry; validation alone cannot prove organization isolation. Self-hosted Sentry would require an explicitly reviewed destination-policy change.

## Controlled staging failure

After secure staging configuration, run `npm run test:sentry:staging` in the intended staging runtime with `SENTRY_STAGING_PROBE=true`. This CLI uses the application's actual server reporting and privacy hooks without installing a public crash endpoint. It emits a fixed controlled failure and failed span with fresh synthetic request/job/generation-request UUIDs. It refuses missing setup and production.

The command prints only safe event/correlation IDs and flush status. A successful flush is not proof of ingestion. Open the selected staging Sentry project, locate that exact event, verify the operation/environment/release and correlated span/UUIDs, inspect the received payload for prohibited fields, and confirm production received nothing. Record the safe event link/reference and verification result here. Do not label a synthetic probe as a paid provider failure or a real persisted job.

Then induce a controlled failure in an isolated staging job with synthetic input and disabled paid adapters, and verify its persisted generation-request/job correlation across the route, worker and event. Keep project credentials and private media out of evidence. Configure owner-approved issue and job-failure alerts with safe links/IDs only and test delivery to the chosen destination.

## Verification and release gates

### Read-only setup audit after implementation

On 5 November 2026, the connected PostHog plugin exposed organization `kumi` and exactly one current-organization project, `Default project` (project ID `334651`). The metadata did not return a region, and no explicitly named staging or production project was present in that list. This is a candidate inventory, not a selection or evidence that no other organization/project exists. No analytics data was queried, project context changed, token printed/stored or resource mutated. The default project was not adopted for either environment.

The Vercel plugin confirmed that the dedicated `kumi-staging` project still uses Node.js 24 and the historical READY release `dpl_7p34A3RfdZwz5x1v7CnUznf767RB`. Complete project-domain pagination returned exactly one verified hostname, `kumi-staging.vercel.app`, with no next page. Environment metadata returned 10 existing Auth/Supabase/Turnstile names, all assigned to the production target of this dedicated staging project, no hidden production entries and no preview-target configuration. There were no telemetry names, `EDGE_ORIGIN_SECRET` or `SIGNUP_IP_HASH_SECRET`. No environment value was decrypted or printed, and no alias, setting or deployment was changed.

The Cloudflare plugin independently returned zero zones (`totalCount=0`, complete pagination). The required guarded release rejects direct `vercel.app` hosts; publishing it to the current alias would intentionally close the existing service rather than establish the requested cache acceptance path. The previously documented lack of an owned domain therefore remains a separate prerequisite for deployed browser/CDN acceptance, even if telemetry stays disabled. Complete the custom-domain/origin-proof transform, matching Auth/Turnstile/PKCE settings and coordinated legacy-signup migration in [the edge rollout runbook](CLOUDFLARE_SETUP.md) before cutover. Do not purchase a domain, guess a hostname, weaken the guard or replay local migrations over the older release to bypass this gate.

No running deployment, ingestion job or external acceptance process is being awaited. Remaining live acceptance requires owner setup choices or an external configuration change; another local test cannot establish those facts.

### Blocked live acceptance audit

The same missing setup remained unresolved across the original implementation turn and two automatic goal continuations. The final read-only revalidation again returned 10 Vercel environment metadata entries, no telemetry variables, no origin-proof/IP-hash secret names, zero hidden production entries, and zero Cloudflare zones across complete pagination. The local process also had no telemetry configuration variable names. No values were decrypted, printed or written.

An independent final audit found the full objective unproven and no necessary independent implementation or verification work remaining that could resolve these live gates. The goal is blocked on owner-selected separate Sentry/PostHog projects and regions, approved privacy/consent/retention policy and alert destinations, and the owned custom staging domain/edge rollout. No domain purchase, project/region assumption, production reuse, unplanned staging outage or weaker local acceptance was substituted. Resume live acceptance once those choices and required external configuration exist; retain the implementation and actual test evidence above.

Installed Next.js **16.4.5** instrumentation, Route Handler, `after`, Proxy, header and caching documentation was read before code changes. The PostHog plugin supplied current integration and Capture API documentation; its organization-knowledge search was unavailable. The Vercel plugin supplied current CDN cache documentation. Inngest environment discovery returned an unavailable-tool error. Plugin discovery returned no Sentry integration. No unavailable plugin was treated as proof that a project or environment does not exist.

Actual local results and remaining hosted/browser/CDN acceptance are recorded in [VERIFICATION.md](VERIFICATION.md). Existing Auth, storage, generation, pricing and infrastructure activation gates still apply; see [AUTH.md](AUTH.md), [STORAGE.md](STORAGE.md), [JOBS.md](JOBS.md) and [SPEND_CAPS.md](SPEND_CAPS.md).

Do not enable production telemetry or claim the goal's live acceptance checks passed until the selected staging Sentry failure is independently observed, PostHog consent/payload behavior is inspected in the real project and browser, and two verified accounts pass the actual browser/CDN cache isolation checks. Local fixtures, intercepted transport and disabled endpoints do not prove production security.
