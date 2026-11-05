# Consent-gated PostHog analytics

Updated: 5 November 2026. This implementation belongs to the independent Flashloop application. It does not change the published GitHub Pages release or the newer deployment checkout. PostHog projects, data region, consent policy approval and alert recipients remain unresolved. No PostHog project was created, token retrieved, hosted event sent or deployment changed in this task.

## Implemented boundary

The application uses the documented server-side [PostHog Capture API](https://posthog.com/docs/api/capture#single-event), rather than loading a third-party analytics script in the browser. The browser sends only a fixed page enum to `POST /api/analytics`. That Route Handler enforces the existing edge-origin guard, exact configured application origin and JSON request marker, a 100-byte streamed body limit, and an exact single-field body. Its responses are private and no-store at the browser and both CDN header layers.

`captureAnalytics(request, event, properties)` in `src/lib/analytics/server.ts` supports `signup`, `signin`, `verification`, `authorization`, `generation`, `quota_rejection` and `webhook`. The HTTP observation wrapper supplies validated server-generated request correlation. The helper also supplies the fixed `pageview` event through `capturePageview`. PostHog event names have a `flashloop_` prefix. An event records its operation and numeric HTTP status; it describes the observed route outcome, not proof that a provider completed a generation or an email was delivered.

Event properties are constructed from an allowlist: validated UUID request/job/generation-request IDs, numeric HTTP status, bounded operation name, selected environment and, for pageviews, a fixed page enum. Unknown properties never enter the outbound body. Invalid request correlation or an arbitrary event/operation prevents capture. The request UUID also serves as the per-request `distinct_id`; there is no persistent analytics visitor identifier or user identification call. These events do not support reliable unique-visitor counts or cross-request user funnels. Internal correlation IDs remain pseudonymous operational data and should have restricted access and a reviewed retention policy.

The transport does not copy request headers, cookies, IP addresses, user IDs, account IDs, emails, form text, prompts, user media, media URLs, signed URLs, query strings, referrers or raw exceptions. It sets `$process_person_profile: false` and `$geoip_disable: true`. The project ingestion token is used only in the required transport field; it never becomes an event property or browser configuration. No autocapture, session replay, feature-flag collection or browser PostHog SDK is installed. Server fetches omit credentials, reject redirects, use no-store and a 1.5-second timeout, and suppress transport diagnostics. A rejected event cannot change authorization, quota reservation or webhook outcomes.

## Consent and privacy controls

Analytics is disabled unless the explicitly selected environment is enabled and an approved consent-policy version is configured. The consent component is absent when configuration is disabled, including static exports. The finished page remains unchanged in that state.

When enabled, an explicit optional-analytics notice offers equal allow/reject controls and a persistent preferences button. Preferences can revoke a previous grant. The `flashloop_analytics_consent` cookie contains only the environment/policy version, `granted` or `denied`, and a timestamp. It uses Path `/`, SameSite Lax, Secure on HTTPS, and a maximum age of 30 days. The server independently rejects expired, future-dated, duplicated, missing, denied and obsolete-policy cookies. Changing the approved version requires renewed consent. This cookie is a privacy preference, never an authorization token.

Browser Global Privacy Control and Do Not Track override a grant. The browser checks navigator signals before sending pageviews and refreshes its choice on focus or visibility changes. A same-origin BroadcastChannel notifies other tabs to reread the cookie and abort pending pageview capture after revocation; the channel carries only a fixed change notification. Focus and navigation checks remain the fallback when channels are unavailable. The server independently checks `Sec-GPC: 1` and `DNT: 1` for every event. Revocation aborts pending browser capture and blocks subsequent events; it cannot recall an event already delivered or retroactively change the cookie snapshot of a service request already received. Page navigation rechecks the current cookie, including changes made in another tab. No durable job or provider callback becomes analytics merely because a job exists: server requests without current browser consent produce no PostHog event. Operational Sentry job tracing is a separate boundary.

The 30-day choice period and supplied notice are implementation defaults, not an approved legal policy. Before activation, the owner must approve the notice, cookie duration, lawful basis, data residency, processors, retention, deletion process and any applicable regional requirements. User-facing privacy documentation must describe the actual deployed behavior.

## Separate environment configuration

Set values only in the intended deployment's secret/configuration store. Do not paste tokens into chat, commit them or print them in diagnostic output. No `NEXT_PUBLIC_POSTHOG_*` variables are needed.

| Variable | Purpose |
| --- | --- |
| `TELEMETRY_ENVIRONMENT` | Exactly `staging` or `production`; no inferred default |
| `POSTHOG_STAGING_ENABLED` / `POSTHOG_PRODUCTION_ENABLED` | Selected environment must be exactly `true` |
| `POSTHOG_STAGING_PROJECT_TOKEN` / `POSTHOG_PRODUCTION_PROJECT_TOKEN` | Separate selected project ingestion tokens |
| `POSTHOG_STAGING_HOST` / `POSTHOG_PRODUCTION_HOST` | Exactly `https://eu.i.posthog.com` or `https://us.i.posthog.com`, chosen from the intended project's actual region |
| `ANALYTICS_CONSENT_POLICY_APPROVED` | Exactly `true` only after approval of actual policy and notice |
| `ANALYTICS_CONSENT_POLICY_VERSION` | Lowercase bounded version such as a date/revision, with no personal content |
| `AUTH_ORIGIN` | Exact owned runtime application origin already used for authentication/CSRF protection |

Configuration never falls back from production to staging. If both project tokens are present and identical, capture is refused. This catches a common configuration mistake; it does not prove the tokens represent separate projects. Provision separate projects, verify their regions and access/retention controls, and install only the selected environment's values. Rebuild after changing layout configuration so the consent UI reflects the chosen configuration. `STATIC_EXPORT=true` always disables analytics and omits the runtime route from Pages.

## Actual verification and remaining gates

`node --test tests/analytics.test.cjs` passed 25 tests. They execute the TypeScript consent, configuration, event builder and handler with synthetic requests and an intercepted fetch. They inspect the exact outbound JSON body and headers, verify consent rejection/revocation/expiry/versioning, GPC/DNT, project separation, bounded pageview input, same-origin/edge rejection, private/no-store responses, invalid-correlation rejection and transport-failure isolation. The browser helper is exercised with synthetic browser signals, cookie state and cross-tab channels to verify opt-out and pending-capture cancellation; these are not real browser tests. Synthetic credentials, personal text, signed URLs, referrers and user IPs do not appear in generated event bodies. Targeted ESLint passed for the new analytics source and modified layout.

These checks prove local application behavior under the tested fixtures. They do not prove PostHog ingestion, hosted project isolation, browser cookie enforcement, deployed CDN behavior or production privacy/security. Browser opt-in, reject, revoke and GPC/DNT behavior must still be checked on the actual staging domain. After setup, use synthetic events only, inspect the PostHog received properties and confirm absent events for opted-out requests. Record project/environment references and verification results without storing tokens or personal data.

The connected PostHog plugin supplied its current integration/product-analytics skills and Next.js/Capture API documentation. Its business-knowledge search was unavailable. Generic SDK recommendations to identify users, collect form identities or retrieve/write tokens were not followed because this task explicitly requires minimal data, approved consent and no stored/printed secrets. No organization-specific privacy policy was inferred.
