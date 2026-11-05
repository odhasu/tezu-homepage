# Cloudflare edge protection setup

Updated: 4 November 2026.

This runbook keeps the Next.js application on Vercel. It does not move hosting to Cloudflare, change the finished frontend, or publish over the newer Tezu GitHub Pages source. The existing [Auth](AUTH.md), [ownership](OWNERSHIP.md), and [shared spend limits](SPEND_CAPS.md) remain applicable.

## Confirmed inventory and deployment status

The connected Cloudflare API returned one account, `4edb6926fe5386f53b53de0d94afe252`, and **zero zones**. The complete zone result had `total_count=0`; this is not an assumption based on the first page. There is therefore no zone plan, active DNS zone, production domain, or staging domain available to configure through this connection. A paid Workers subscription would not by itself establish a zone's WAF plan.

No Cloudflare DNS record, ruleset, certificate, subscription, or callback exception was created or changed during this inspection. No Cloudflare-to-Vercel request, live edge burst, or direct-origin denial has yet been demonstrated. Local tests and generated rule descriptions cannot establish that a deployed site is protected.

The existing dedicated runtime staging project is `odhasus-projects/kumi-staging`, with its historical origin at `https://kumi-staging.vercel.app`; see [AUTH.md](AUTH.md) for its release record. The existing Vercel `flashloop` project is unrelated and must not be modified as a substitute. Production application selection remains unresolved. The [GitHub Pages frontend preview](https://odhasu.github.io/tezu-homepage/flashloop/blue/) is static and cannot run these Route Handlers or origin controls.

The user confirmed they do not yet own a domain. Production and staging hostnames, the zone, plan, and final edge rate thresholds remain unresolved. The successful-signup quota is agreed: two account creations per IP per rolling 96 hours; see [implementation status](EDGE_PROTECTION.md). The numbers below are **proposals, not approved limits**. They are explicit so an operator can review the exact policy before enabling it.

## Proposed edge rules and plan constraints

Current [Cloudflare availability documentation](https://developers.cloudflare.com/waf/rate-limiting-rules/#availability) distinguishes the following zone plans:

| Zone plan | Rate rules | Expression fields relevant here | Counting windows | Block duration |
| --- | --- | --- | --- | --- |
| Free | 1 | Path; Verified Bot | 10 seconds only | 10 seconds only |
| Pro | 2 | Host, URI, path, full URI, query; Verified Bot | Supported values up to 60 seconds | Supported values up to 1 hour |
| Business | 5 | Pro fields plus method, source IP, user agent | Supported values up to 600 seconds | Supported values up to 1 day |

Do not paste a host/method expression into a Free rate rule. Do not assume Pro supports method matching merely because its custom WAF rules support it. The plan-specific rate-rule matrix is authoritative. Counting characteristics, response customizations, and available fields must be read back after deployment.

### Free proposal: one combined rule

Use a single path-only rule so both endpoints receive edge protection within the one-rule allowance:

```text
(http.request.uri.path in {
  "/api/auth/signup" "/api/auth/signup/"
  "/api/checkout" "/api/checkout/"
})
```

- Name: `flashloop-signup-checkout-burst`.
- Characteristic: source IP, using Cloudflare's required data-center characteristic when the API requires it.
- Threshold: **20 requests per 10 seconds**, combined across the listed paths for that IP.
- Action: **Block** for **10 seconds**. Keep API requests out of interactive challenge pages.
- Match all methods because Free does not offer method filtering in rate rules.
- Scope: all matching paths in the zone, including both staging and production if they share a zone. Free cannot independently scope this rate rule by hostname. If those environments need separate budgets, use separate zones where appropriate or choose a plan that supports the required rule structure.
- No Verified Bot, user-agent, header-presence, cookie-presence, or callback exemption.

### Pro/Business proposal: separate rules

When the zone has two unused rate-rule slots, use separate source-IP counters:

| Rule | Paths | Threshold | Window | Block duration |
| --- | --- | --- | --- | --- |
| Signup | `/api/auth/signup`, `/api/auth/signup/` | 20 requests/IP | 10 seconds | 10 seconds |
| Checkout | `/api/checkout`, `/api/checkout/` | 20 requests/IP | 10 seconds | 10 seconds |

Pro can add the explicitly chosen application hostnames to each expression. Business can additionally constrain the rules to `POST`. These are the same short-window proposals as Free, with independent endpoint budgets; longer plan-supported windows are available but have not been selected. If production and staging share a zone and each needs its own two rules, Pro's two-rule allowance is insufficient. Do not replace existing rules blindly to make room.

Use the [rule parameters](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/) and [API setup guide](https://developers.cloudflare.com/waf/rate-limiting-rules/create-api/). Inspect the existing `http_ratelimit` ruleset first; append deliberate rules instead of replacing unrelated protections. Configure a JSON `429` response on plans where available. On Free, clients must also tolerate Cloudflare's default HTML rate-limit response.

Cloudflare documents [per-data-center counters and a possible delay of a few seconds](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/) while counters update. Its rate rules are burst mitigation, not a precise global quota or an account identifier. The server's shared PostgreSQL limits remain mandatory. Test URL normalization and encoded/trailing-slash path variants against the actual edge and Next.js routing before declaring coverage complete.

### Shared-IP and account behavior

The proposed edge rule counts an IP, so a university, office, carrier NAT, or household can share its counter. Do not bypass it for browser-supplied account headers. Keep its burst threshold broad enough for the expected shared-IP population and tune it using observed staging traffic after agreement.

Separately from the agreed successful-creation quota, the signup service limits email identities to **5 attempts per 600 seconds** and the source IP to **20 attempts per 600 seconds** in shared PostgreSQL. Signup is pre-account, so its normalized email budget is not proof that an authenticated account exists. Checkout uses an authenticated, verified Supabase account's subject for its proposed **5 attempts per 600 seconds** budget; client-supplied account IDs must not select that counter. Distinct verified accounts behind one IP have separate account counters, while the broad IP ceiling still applies. Confirm these values against code and migration readback before rollout.

Server responses must be `private, no-store`. Attempt-limit denials return **429 with Retry-After: 600** because the boolean PostgreSQL limiter cannot report the remaining window; blocked attempts do not extend that database window. Limiter failures and the deliberately unavailable checkout return **503 with Retry-After: 600**. The successful-signup quota is different: its **429** carries the exact remaining rolling-window delay, bounded to **1–345600 seconds**. Clients must not retry before the advertised delay. Edge responses may include `Retry-After`, but its presence and value must be verified on the selected plan; do not infer a modern WAF guarantee from the retired rate-limiting product's docs. If the edge returns HTML without the header, wait at least the configured 10-second block duration before a new user-initiated attempt. Avoid automatic signup or checkout retry loops.

Whop remains deferred. `/api/checkout` must return an unavailable response after its checks and must never create a payment session, charge an account, grant credits, or write entitlements. Rate limiting does not authorize payment functionality.

## DNS and TLS runbook

1. Select the exact production and staging hostnames and their owning application projects. Add or select the correct Cloudflare zone and confirm its plan. Do not buy a plan, transfer nameservers, or change an unrelated zone based on a guessed hostname.
2. Inventory all existing DNS records, email/MX/TXT records, nameservers, redirects, rules, and certificate settings. Preserve them. For a new full zone, complete registrar nameserver delegation and wait until Cloudflare reports it active.
3. Add each exact custom hostname to its intended Vercel project. Use the DNS record values returned by that project's current domain setup; do not assume a universal Vercel IP/CNAME value. Complete Vercel ownership verification and certificate issuance. Keep verification records DNS-only where required.
4. Create only the necessary application A/AAAA/CNAME records and enable Cloudflare proxying (orange cloud). Check for DNS-only aliases or IPv6 records that unintentionally expose another serving path. An origin URL can still be discovered even when DNS is proxied, so DNS is not origin authentication.
5. Set Cloudflare SSL/TLS to **Full (strict)** after Vercel has a valid certificate for each custom host. Verify HTTPS routing and redirects. Do not use Flexible mode.
6. Keep Cloudflare Pseudo IPv4 disabled so `CF-Connecting-IP` retains the actual client address expected by the server. Review client-IP managed transforms and any Workers that could replace this header. The server may trust it only after validating the edge proof.
7. Review incoming URL normalization and test encoded path equivalents. Disable or correct rules that rewrite signup/checkout to an unprotected equivalent. Check both apex and `www` aliases explicitly; use a deliberate canonical redirect or protect each served hostname.

Cloudflare's [proxy status](https://developers.cloudflare.com/dns/proxy-status/) and [Full (strict) mode](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/) explain the underlying settings. Updating a Vercel alias alone does not move its DNS behind Cloudflare.

## Origin proof and direct-origin handling

The application origin guard is required on Vercel (`VERCEL=1`) even if `EDGE_PROTECTION_REQUIRED` is false. `EDGE_PROTECTION_REQUIRED=true` also enables it on another runtime. It requires the configured HTTPS `AUTH_ORIGIN` custom hostname and `x-flashloop-edge-key` matching the server-only `EDGE_ORIGIN_SECRET` with a timing-safe comparison. The secret must be 32–256 characters and generated with cryptographically secure randomness. Production and staging need different values.

An operator must generate and transfer the secret through provider secret stores, never chat, source files, shell command arguments/history, URL query parameters, screenshots, or logs. `.env.example` records names only. Do not read back, print, echo, return, or include the value in a troubleshooting response.

Configure a Cloudflare **Request Header Transform Rule** for each exact served custom hostname:

- Set `x-flashloop-edge-key` to the secret value, **overwriting** any inbound value; do not append and do not set only when absent.
- Apply it to the whole application, including HTML, static assets, all API routes, and `/api/auth/callback`.
- Keep production and staging host matches and secret values separate.
- Check later transform rules cannot remove or replace it. Review any Worker route or upstream rewrite that could bypass the intended WAF phases or disclose the header.
- Do not put the secret in a response header, client bundle, public environment variable, CSP, redirect, or cache key. Redact it from request logging and telemetry, and never forward it to a third-party origin.

[Transform Rules are available on Free](https://developers.cloudflare.com/rules/transform/), with 10 active rules; Pro allows 25 and Business 50. [Request Header Transform Rules](https://developers.cloudflare.com/rules/transform/request-header-modification/) can set a literal value and overwrite an existing value. This approach does not require a Worker or a hosting move. Ruleset access is security-sensitive because authorized operators can inspect a static header value; restrict dashboard and API permissions.

The Next.js proxy covers application paths, and sensitive Route Handlers repeat the guard so an omitted matcher or framework routing change cannot silently remove their origin check. After proof validation, `CF-Connecting-IP` can identify the edge's client address; `CF-Ray`, `X-Forwarded-For`, `Host`, `Origin`, or a Cloudflare-looking user agent alone are not proof.

Direct Vercel aliases and immutable deployment URLs must not serve protected functionality. A request sent directly to Vercel using the custom hostname must also fail without the secret. Neither a spoofed `Host` nor a forged `CF-Connecting-IP` is a valid exception. Configure Vercel Standard Protection for generated deployment URLs and previews as additional protection, verify its exact scope, and retain the application guard on custom domains. Protect or remove historical deployments and aliases containing older code; deploying a new guard does not change previous immutable deployments.

Cloudflare [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/) requires certificate validation at the origin. Do not claim it protects this Vercel application merely because its Cloudflare toggle is on; Vercel must explicitly support and enforce the relevant origin client certificate configuration. A shared Cloudflare IP allowlist alone would not establish that traffic came through this zone's rules.

Set `AUTH_ORIGIN`, Turnstile hostname/sitekey allowed hosts, Supabase `site_url`, and the exact PKCE callback allowlist to the chosen custom staging host before enabling signup there. Do the equivalent production work only against its intentionally selected resources. The historical `vercel.app` callback must not remain an alternative supported signup path after cutover. Missing custom domain, secret, or edge rules should leave the new guarded runtime closed, not silently fall back to unprotected Vercel access.

## Supabase's direct endpoint remains protected

Cloudflare application DNS does not proxy `*.supabase.co`. Retain native Supabase Turnstile CAPTCHA, email confirmation, Before User Created signup-permit hook, password policy, provider restrictions, session verification, RLS, and provider rate limits. Do not disable those controls to make the edge tests pass. A server-issued signup permit remains email-bound and single-use; browser metadata cannot grant access or credits. The new local quota migration also binds its private record to an IP HMAC and charges the agreed two-creations-per-96-hours budget on successful account insertion. It has not been applied to the current hosted release; follow the coordinated rollout in [EDGE_PROTECTION.md](EDGE_PROTECTION.md).

The committed [Auth configuration](../supabase/config.toml) records `sign_in_sign_ups=30`, `token_verifications=30`, and `token_refresh=150`, plus `email_sent=2`. Read back hosted configuration: the earlier CLI reported `email_sent` unmanaged and the built-in sender retains its own two-emails/hour restriction. Preserve the existing provider configuration unless intentionally migrating its exact callback/domain settings. See [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha).

## Callbacks and deliberate exceptions

No machine callback exemption is enabled. No Whop, payment, or Inngest callback endpoint is implemented by this milestone. The browser's PKCE email callback remains inside origin protection; it is not a machine webhook.

Concurrent storage work added an `/api/inngest` route. It must retain the same origin proof and its own SDK signature verification. This edge milestone adds no exemption for that route and does not establish that an Inngest Cloud application is configured.

Before a future callback exception is added, define its exact hostname/path/method, provider authentication scheme, signed raw-body verification, timestamp tolerance, replay retention, and bounded server-side handling. A signature-looking header, user agent, `cf.client.bot`, or `cf.bot_management.verified_bot` does not verify an application callback. Verify the actual signature and event identity before performing any privileged action. If the edge cannot authenticate that signature, a broad skip based on its presence is not justified.

Use the narrowest intended exclusion and retain origin proof. A callback can use its own dedicated authenticated hostname or receive the same Cloudflare-injected header. Never give the callback route an unauthenticated direct-Vercel exception. If a deliberate WAF Skip rule is required, skip only the necessary phase for independently verified traffic and record its reason, owner, and review date. Cloudflare [Skip options](https://developers.cloudflare.com/waf/custom-rules/skip/options/) can bypass the entire `http_ratelimit` phase; that is broader than excluding one endpoint from this rule. Free Bot Fight Mode [cannot be skipped](https://developers.cloudflare.com/waf/feature-interoperability/), so evaluate its impact before enabling it around future machine traffic.

## HTTP caching

Keep auth, account, checkout, user data, quota errors, and origin-denial responses `private, no-store`. Configure Cloudflare to bypass cache for `/api/*`, `/account`, and `/auth/*`, and for authenticated responses as applicable; do not enable a broad Cache Everything rule over them. Respect origin cache headers. Check existing Page Rules, Cache Rules, Workers, and Vercel routing overrides for conflicting caching behavior.

Public, versioned frontend assets can retain their existing immutable policy. Never cache a successful protected response in a way that serves it before origin proof checks, or cache one account's response for another. Inspect both Cloudflare and Vercel cache headers during live tests. A static Pages preview is not evidence of runtime cache behavior.

## Rollout, verification, and remaining setup

Do not deploy a release that mandates edge proof to the currently public staging alias before the custom domain and transform are ready unless an intentional maintenance closure is agreed. Prepare the custom-domain configuration and protected deployment, validate it, then cut traffic over. If cutover fails, close signup/checkout and restore a known guarded release; do not remove origin validation, disable native Supabase CAPTCHA, or open direct aliases as a workaround.

The live completion gate requires recorded evidence for all of the following:

1. Both selected domains resolve through Cloudflare, use valid HTTPS, and reach the intended separate Vercel projects. Read back zone plan, proxied records, exact expressions, rule ordering, thresholds, windows, actions, and origin-header configuration without reading its secret value.
2. A bounded test exceeds each edge threshold and receives `429`; record the actual `Retry-After` behavior and recovery after the mitigation window. Keep test traffic within a disposable staging environment until production testing is authorized.
3. Shared PostgreSQL limits return bounded `429` plus appropriate retry time across independent application instances and persist across restarts. Verify different accounts behind a shared IP have distinct account budgets, and document the deliberate shared-IP ceiling.
4. Direct Vercel aliases, current immutable deployment URL, old deployment URLs, and direct-origin requests using the custom `Host` fail without proof. Forged Cloudflare headers fail. Missing/invalid secret configuration fails closed.
5. Valid browser signup, sign-in, email PKCE callback, session refresh, and account reads work through the custom host. Direct Supabase signup still rejects missing/invalid CAPTCHA and missing/replayed permits. Preserve the previously documented limits of browser/provider test evidence.
6. Checkout remains unavailable and no payment session, credit grant, or entitlement mutation occurs. Verify no machine callback path receives an implicit bypass; future verified webhook tests require the future signed contract.
7. Protected responses and errors remain uncached through both CDNs. Public frontend assets retain their intended caching and visual behavior.

Outstanding setup: chosen domains; Cloudflare zone and plan; approved thresholds and shared-IP population expectations; Vercel production project selection; custom-domain/certificate/DNS verification; separate origin secrets and header transforms; edge rule deployment/readback; preview and old-deployment protection; callback allowlist/Turnstile host updates; live acceptance checks. The future Whop contract remains deferred. Record actual test results in the milestone verification notes; do not turn this checklist into a claim that the checks ran.
