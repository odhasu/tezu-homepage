# Optional Cloudflare staging front door

Updated 6 November 2026. Preparation only: no Worker, deployment, provider setting, migration or secret has been changed by this implementation.

## Purpose and boundary

A dedicated Worker on a `workers.dev` hostname can provide an HTTPS staging entry point without registering a domain. Next.js Route Handlers, Supabase authorization, private account data and durable jobs remain on the dedicated Vercel application. This does not move the application to Workers or make the GitHub Pages export a runtime server.

Cloudflare documents `workers.dev` as suitable for getting started and hobby/noncritical use, with a custom domain or route recommended for production. This is an optional staging transport, not production-domain acceptance. The account's `oscargraafmans630` subdomain was observed read-only; the unrelated existing `steep-voice-9a31` Worker must be preserved.

## Application contract

The existing default `transform` mode in `src/lib/security/edge-origin.ts` is unchanged. It still requires the configured public Host and a valid origin secret on Vercel. Unknown modes fail closed.

The optional `EDGE_ORIGIN_MODE=worker-proxy` mode additionally requires:

- `AUTH_ORIGIN`: exact canonical public HTTPS origin, with no trailing slash, path, query, credentials, custom port or `.vercel.app` hostname. A configured `workers.dev` hostname is allowed.
- `EDGE_UPSTREAM_ORIGIN`: exact intended Vercel HTTPS origin ending in `.vercel.app`, with no path, query, credentials or custom port.
- `EDGE_ORIGIN_SECRET`: separate staging proof secret supplied through provider secret stores, never source, chat, logs or shell arguments.
- The routing Host must equal the configured upstream Host or the exact validated platform `VERCEL_URL` hostname for this deployment. A broad `*.vercel.app` allowance is never used.
- Only after timing-safe secret validation does the application inspect `x-flashloop-public-host` and `x-flashloop-client-ip`. The public host must match `AUTH_ORIGIN` exactly and the IP must parse as one address. `trustedClientIp` uses that proof-bound field in this mode, not arbitrary Cloudflare/forwarding headers.

Neither proof nor metadata authorizes a user. Existing live Supabase user/session verification, confirmed email, revocation, ownership checks and RLS remain required on every protected request. Origin and Fetch Metadata CSRF checks remain tied to the browser's canonical public origin.

## Worker contract

`cloudflare/staging-proxy.mjs` remains disabled unless the `ENABLED` binding is exactly the string `true`. Its other bindings are `PUBLIC_ORIGIN`, `UPSTREAM_ORIGIN` and `EDGE_ORIGIN_SECRET`. Public/upstream bindings must match the corresponding Vercel settings above. There are no credentials in the module.

The Worker accepts only its exact public origin and an optional matching Host. It takes the client IP from Cloudflare's inbound `CF-Connecting-IP`, strips visitor-supplied proof/forwarding metadata and hop-by-hop headers, then injects the fixed upstream Host, proof, public host and private client-IP field. Browser `Origin`, cookies and Fetch Metadata remain intact. Upstream URL construction uses a fixed origin plus path/query properties, so a `//other-host` path or destination query cannot turn it into an open proxy.

Upstream fetch uses `redirect: manual` and `cache: no-store`. The Worker never follows redirects with its proof. Only relative redirects and redirects to the exact public/upstream origins are rewritten to the public origin; outside/credential/protocol targets produce a generic private 502. The `Refresh` header is removed. No provider, OAuth, Whop, Sentry or signed-media destination is added to this redirect allowlist; enabling those flows requires their own exact reviewed redirect policy.

HTML, RSC, media and request bodies stream through unchanged. Multiple `Set-Cookie` headers are preserved; the existing application emits host-only HttpOnly/Secure/Lax cookies. Known internal `x-flashloop-*` response headers are removed. Proxy-generated errors contain fixed text, not exceptions or upstream diagnostics. This is not arbitrary upstream-body redaction: the application must never reflect the proof in content or logs.

API/auth/account paths, encoded/ambiguous paths, errors, redirects, cookie-setting responses and requests carrying cookies or Authorization receive browser/CDN private/no-store headers. Other public responses retain the application's deliberate public caching headers. No Cache API is used. **Keep Workers entrypoint caching disabled in deployment configuration:** it runs before the handler, so handler code and a no-store subrequest cannot establish that a gateway cache never skipped authorization.

The module has no request/query/body logging. Before activation, inspect platform logging/tracing settings and data handling so credentials, auth cookies, callback codes, personal prompts and signed URLs cannot enter retained logs. Do not enable request/header/body capture by copying a generic observability configuration.

## Safe activation still required

1. Review the exact proposed hostname and fixed dedicated Vercel project. Do not replace the unrelated production Flashloop source or existing unrelated Worker. Use a new staging Worker and disable its preview/version addresses or separately require an intentional exact-host policy.
2. Provision the same proof in Worker/Vercel secret stores without reading or printing it. Keep staging/production secrets separate. Confirm Workers entrypoint caching remains disabled, platform log redaction is appropriate, and deployment protection works without turning it off.
3. Reconcile hosted schema drift before applying the reviewed signup quota migration. Current staging has only auth/ownership migrations; do not replay the entire local chain blindly. Set the separate stable signup-IP hash secret through the secret store.
4. Configure exact public `AUTH_ORIGIN`, Turnstile allowed hostname/Siteverify hostname and Supabase site URL/PKCE callback. The built-in Supabase sender is restricted to allowed organization inboxes; unrestricted public signup still needs SMTP and sending-domain setup. Do not disable confirmation/CAPTCHA to make tests pass.
5. Stage the reviewed application and Worker with functionality closed until coordinated checks pass. Direct Vercel aliases and old immutable deployments must not serve a bypass. Verify exact header behavior in the actual Cloudflare-to-Vercel hop before cutover.
6. Verify real allowed-inbox signup, email PKCE callback, separate CAPTCHA steps, login, verification landing in the dashboard, logout/revocation and refresh. Test two verified accounts in real browsers through both CDNs, including RSC/prefetch/back-forward restoration and unchanged shared URLs. Inspect only safe assertion/status/header summaries.

Generation still uses the user-requested local loading preview until a provider is configured. This transport does not enable R2, Whop fulfillment, telemetry ingestion or a live MCP connection.

## Verification actually performed

The synthetic Node.js Worker tests use real `Request`, `Response`, `Headers` and streams with a controlled fetch implementation. The edge tests exercise the actual TypeScript guard through transpilation. They cover disabled/invalid configuration, proof/host/IP spoofing, exact upstream/deployment binding, CSRF-context preservation, fixed-target URLs, manual redirect rejection/rewriting, no-store policies, response-header stripping, streamed bodies, distinct cookies and generic transport failures. A combined synthetic test sends the module's generated request through the real edge guard.

These tests establish local contract behavior only. They do not establish Cloudflare IP authenticity, Vercel header routing, hosted cookies/SMTP/Auth/RLS, deployed browser/CDN caching or production security. No hosted test, deployment or secret operation is implied.

Executed on Node.js 24: the focused edge/Worker run passed **56 tests**, the complete existing edge suite passed **72 tests**, scoped ESLint passed for `edge-origin.ts`, `npx tsc --noEmit` passed, and `node --check` passed for the new Worker module/test. The counts cover synthetic local behavior only; no hosted deployment was exercised.

Focused checks:

```sh
node --test tests/edge-origin.test.cjs tests/staging-proxy.test.mjs
npx eslint src/lib/security/edge-origin.ts
node --check cloudflare/staging-proxy.mjs
```

References consulted:

- [Cloudflare workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)
- [Cloudflare visitor IP headers and Worker subrequests](https://developers.cloudflare.com/fundamentals/reference/http-headers/)
- [Workers fetch caching](https://developers.cloudflare.com/workers/examples/cache-using-fetch/)
- [Workers entrypoint cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel reverse-proxy migration](https://vercel.com/docs/incremental-migration)
