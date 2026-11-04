# Kumi signup and verification

Updated: 4 November 2026. This is the authentication implementation for the independent Flashloop Next.js app. The Tezu/Krea apps and published GitHub Pages release are unchanged.

## Resource boundary

| Resource | Current identity |
| --- | --- |
| Supabase | `kumi`, reference `txwclngedcporvrfbolu`, organization `lukas`, region `eu-west-1` |
| Vercel | Dedicated `odhasus-projects/kumi-staging`, project `prj_JqLdiHCni81bVfHQ1KkUYsL2Yvsa` |
| Auth origin | `https://kumi-staging.vercel.app` |
| Current staging release | `dpl_EziEm1g31giSYiHmDWMfvHTBrEwz`, READY, Node.js 24; this is the dedicated staging project's production target, not the unrelated production application |
| Allowed email callback | `https://kumi-staging.vercel.app/api/auth/callback` only |
| Turnstile | Managed `kumi-staging` widget; staging, `localhost`, and `127.0.0.1` widget domains; staging Siteverify accepts only its exact hostname |
| Previous Supabase project | `lucasresellzcodex` was paused, not deleted, to free an active free-project slot after the user authorized making room for Kumi. Its data was retained. |

The existing Vercel `flashloop` project is unrelated and was not modified. No R2, AI-provider, Inngest, payment, or live MCP integration was added. No provider generation can run through this change, and accounts receive no automatic video credits.

## User flow and enforcement

The user selected email/password, confirmed email, and a second Turnstile check. `/auth` signs in, `/auth/signup` creates an account, `/auth/verify` completes the per-session gate, and `/account` is a protected server-rendered example. `/api/account` is the protected API. Auth links in the existing header use these routes when `NEXT_PUBLIC_AUTH_ENABLED=true`.

Signup and sign-in each collect separate fresh tokens: the first is consumed by the Next.js backend's Siteverify call, and the second by native Supabase CAPTCHA enforcement. A single token cannot be redeemed by both validators. The backend requires exact hostname/action, a valid challenge timestamp younger than 300 seconds, provider success, and a bounded nonempty token. Provider/network/JSON errors deny the request. Cloudflare supplies cross-instance single-use enforcement; no in-memory replay cache is used.

After successful pre-signup Siteverify, the server issues a random, email-bound, five-minute signup permit. The supported Supabase Before User Created hook atomically consumes its SHA-256 hash. Consequently, direct public Auth signup must satisfy native CAPTCHA and possess the server-issued permit. User metadata transports that permit; metadata never grants authorization or credits. See [database implementation](../supabase/README.md).

Email confirmation uses Supabase PKCE and an exact callback. Cookies are HttpOnly, SameSite=Lax, and Secure on staging. Mutations require the configured Origin, a same-origin Fetch Metadata value when present, JSON content, and the custom request header. Callback targets are fixed. All auth/account responses are private and uncached.

Verification transitions the exact live session to `verifying` before Siteverify. Only the server can finalize it. Failure persists terminal denial, calls supported local sign-out to revoke the relevant Auth session/refresh token, and clears browser auth cookies even when sign-out throws. Protected handlers and RLS consult current session/database state on every request, so an issued JWT cannot restore failed or logged-out access. A new login creates a new pending session. `/account` has a scoped Next.js proxy to refresh and persist cookies before rendering; the proxy does not replace authorization.

The hosted Auth configuration enables native `turnstile` CAPTCHA, confirmed email, password minimum 12, and the Before User Created hook; anonymous and other signup providers remain disabled. Hosted sign-in/signup, token-verification, and refresh limits are configured in [config.toml](../supabase/config.toml). The CLI reports `email_sent` as unmanaged; the provider's built-in sender remains limited to two emails/hour. Website limits additionally run by IP before email to prevent rotating-email counter growth. Shared PostgreSQL counters expire.

## Verification actually performed

- `npm run check`: lint, strict TypeScript, **50 security/handler assertions**, 93-file asset audit, and runtime production build passed on Next.js **16.4.5**.
- `npm run test:auth:database`: **69 PostgreSQL assertions** passed using the real migration in PGlite with actual role/RLS enforcement. This fixture is not Supabase Auth.
- Runtime build includes `/account`, `/api/account`, `/api/auth/[operation]`, and the scoped proxy. Static export omits runtime handlers/proxy; the Pages asset audit passed for **85 routes/assets**.
- Production dependency audit reports zero vulnerabilities. The full dependency audit still reports eight moderate development-tooling findings.
- Hosted migration applied to Kumi. Security advisors reported no errors or warnings; three informational notices identify intentionally policy-free private tables, which deny direct access. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Real Cloudflare secret validation rejected a dummy token with `invalid-input-response` and no `invalid-input-secret`.
- [Provider smoke script](../scripts/verify-auth-provider.mjs): **8 hosted assertions** passed. Direct Auth rejects missing/invalid CAPTCHA; anonymous permit issuance fails; a real Auth-created fixture gets exactly zero credits despite forged metadata; a signed JWT is denied before verification and after failure; supported logout invalidates session and refresh token.
- [Website smoke script](../scripts/verify-auth-website.mjs): **7 deployed assertions** passed. The deployed API rejects anonymous/pending sessions; invalid real Turnstile verification clears cookies and invalidates existing JWT/refresh access; a verified fixture reads zero credits with no-store; CSRF cannot force logout; failed re-verification revokes an already verified session.
- Smoke users are disposable `.invalid` addresses created through trusted administration without email. They were signed out and removed. The hosted database was checked afterward: zero users, sessions, and credit-account rows remained.

Missing/invalid/expired/replayed/wrong-host/wrong-action tokens and provider failures are covered by local tests. Human challenge success/replay through the deployed website, actual delivered email and PKCE callback, and a browser's expired-token refresh are **not yet proven**. Administrative fixture verification does not prove those paths.

The deployed signup page rendered in Chrome and advanced to the second challenge. Cloudflare then returned `300030`; the form cleared its tokens, showed a retry message, and kept account creation disabled. Cloudflare documents the `300*` family as bot-detection challenge failures. This is not proof of successful human signup. The open browser tab was handed to the user for a normal browser attempt; no CAPTCHA protection was disabled or bypassed. See [Cloudflare client error codes](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/).

## Remaining setup and completion gate

Supabase's built-in sender only sends to organization-member inboxes. A complete staging signup should first be tested with an allowed organization email, followed by its emailed PKCE confirmation and the second challenge. General public signup requires an SMTP sender and verified sending domain; no domain is connected to the current Cloudflare account. Do not disable email confirmation to work around sender limits.

The goal remains active until the real browser/email/Turnstile acceptance checks are finished. No claim of production readiness is made. The user must enter their own credentials during browser testing; credentials must never be pasted into chat or notes.

## Configuration and rollback

Names only appear in [.env.example](../.env.example). Actual secret values are held in Vercel/provider stores. A local ignored env file in the healthy deployment checkout was used for the CLI's CAPTCHA secret reference; it must never be committed. Vercel cannot pull back the sensitive Supabase secret, so local env pulls contain a placeholder for it.

`AUTH_ENABLED`, `AUTH_PROVIDER_CONFIGURED`, and `NEXT_PUBLIC_AUTH_ENABLED` are explicit deployment switches. Disable them and redeploy Kumi staging to close website auth. If necessary also set `auth.enable_signup=false` and push the partial config to Kumi only. Preserve the hook, CAPTCHA, denial state, and RLS while any issued JWT may exist. Do not drop tables or remove checks as a rollback shortcut. The GitHub Pages visual preview remains a static release, without a server backend.
