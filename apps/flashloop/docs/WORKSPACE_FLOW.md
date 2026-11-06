# Flashloop workspace flow

Updated 6 November 2026.

## Scope

The user requested one Flashloop flow and a public GitHub Pages preview that includes the image and video workspaces. They subsequently confirmed that no owned domain or generation provider is available yet, and explicitly requested that generation remain in a loading state for now. The finished blue homepage is preserved. Kumi remains the internal name of the existing staging Supabase/Vercel resources; it is not a second product UI.

- `/create/image/` and `/create/video/` are public, static workspace previews. Controls and local file previews work without pretending to authenticate a visitor, spend credits, or generate media. Generate starts an explicitly local, cancellable loading preview that waits for provider setup; it does not send a generation request or fabricate a persisted job.
- `/account` renders the shared workspace only after the existing edge-origin check and live, confirmed, verified Supabase session checks. Its account APIs remain private/no-store and owner scoped.
- Successful session verification opens `/account` with an allowlisted image/video tool choice instead of returning to the marketing homepage.
- Header Login/Signup, core creation calls to action, pricing, model catalog, connection and creator-program navigation use local Flashloop routes. Remaining reference documentation, specialized feature pages and external social/app-store destinations retain their original external destinations; this change does not implement those services.
- Live ChatGPT/MCP remains deferred. Its local page states that no account connection is made.

## Draft privacy

Submitting the homepage composer saves a same-tab draft for up to 30 minutes and navigates without putting prompt text in a URL. The workspace consumes that draft once. A blocked storage operation leaves the user on the composer with a copy-before-navigation explanation. Attachments are never placed in storage or a URL, and the composer explains that they must be removed before a text-only handoff. Explicit sign-out clears the pending draft.

Draft fields are local functional state, not analytics events. No prompt, media, file name, auth token or signed URL is sent to analytics by this flow. Browser storage is not an authorization source. Tool choice is restricted to `image` or `video`; neither a URL parameter nor a draft can authorize API access. The private session endpoint supplies a verified-only, opaque session binding so the runtime workspace can clear previous session state after account changes. This binding carries no authority and is excluded from analytics; credit display comes from the fresh session response.

## Hosting and activation

GitHub Pages serves exported HTML, CSS, JavaScript and public assets. It cannot run Next.js Route Handlers, cookie-based server sessions, Whop webhook fulfillment, private signed links or durable provider jobs. Those remain on the intended Vercel runtime behind the required protected domain. The static preview does not contain runtime API/account routes or service credentials.

The existing unrelated `flashloop` Vercel project and its newer deployed source were not replaced. The root Tezu and other application sources were not changed. Publication is limited to `apps/flashloop` in the existing GitHub Pages checkout.

Live runtime activation still requires the owned protected domain and origin-proof setup, current reviewed hosted migrations, public email delivery configuration, generation provider adapters/pricing/caps, R2 enablement and private storage setup, Whop application/webhook secrets and fulfillment acceptance, and the separate monitoring/consent decisions documented in the existing service notes. A static preview, mocked provider or local test does not establish production security or completed payment/generation fulfillment.

## Verification

- Installed Next.js 16.4.5 documentation was read before changes: static exports, Route Handlers, caching, authentication, and redirects.
- Five Node.js draft-handoff tests passed: one-time consumption, expiry/corrupt input rejection, bounded prompt size, safe tool preservation across authentication, explicit clearing and blocked-storage handling.
- The complete check passed with 396 Node.js tests, strict TypeScript, ESLint (one pre-existing warning in the excluded untracked `service 2.ts` duplicate), the 93-asset audit and static production build. The export audit verified 99 route/asset destinations. An explicit `NEXT_PUBLIC_AUTH_ENABLED=true` input still produced disabled public auth and local static editor links, confirming the static-build override.
- The normal runtime production build also passed. In a credential-free copy of the resulting build, 28 actual local HTTP cache checks passed, including private errors/routes, synthetic disabled account jars, versioned framework assets and mutable-asset conditional revalidation. The first runner in the deployment checkout correctly failed its public-startup condition because its pre-existing ignored Vercel environment file activated the mandatory edge guard; no origin guard was weakened.
- A local exported-browser check showed the video example prompt, enabled Generate, continuous local loading state, explanatory provider-setup message and Cancel control. At the browser’s 319px viewport, document width remained 319px. Live browser/publication results are recorded in `VERIFICATION.md` after execution.

See [AUTH.md](AUTH.md), [OWNERSHIP.md](OWNERSHIP.md), [JOBS.md](JOBS.md), [STORAGE.md](STORAGE.md), [BILLING.md](BILLING.md), [OBSERVABILITY.md](OBSERVABILITY.md), and [CACHING.md](CACHING.md) for the actual service boundaries and missing setup.
