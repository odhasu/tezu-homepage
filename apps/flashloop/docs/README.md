# Flashloop implementation notes

Sentry manual error/job tracing, consent-gated PostHog analytics, safe request/job correlation, environment separation, current verification and unresolved live setup are recorded in [OBSERVABILITY.md](OBSERVABILITY.md). HTTP/browser/CDN cache policy and remaining two-account deployment acceptance are in [CACHING.md](CACHING.md). Telemetry is disabled until approved configuration is supplied; this supersedes older notes saying integration code is absent. No hosted telemetry ingestion or deployed cache-isolation acceptance has been claimed.

The user-requested PostHog wizard execution and newly installed Sentry plugin's actual authentication requirements are recorded in [POSTHOG_WIZARD.md](POSTHOG_WIZARD.md). The wizard was launched in an isolated audit copy; browser authorization and an authenticated result must be observed before claiming it completed.

Durable generation dispatch, permanent paid-operation claims, provider-ID bindings, atomic callback receipts/settlement, restart recovery, actual verification, and provider activation gates are recorded in [JOBS.md](JOBS.md). Production provider adapters are absent and generation/webhooks remain disabled. This supersedes older notes describing worker transport as entirely unimplemented.

Whop individual monthly subscription catalog, verified provider identity linking, checkout claims, signed receipts, expiring credit buckets, reconciliation, actual checks, and activation gates are recorded in [BILLING.md](BILLING.md), [BILLING_DB.md](BILLING_DB.md), and [VERIFICATION.md](VERIFICATION.md). Whop resources remain hidden and runtime payment fulfillment is disabled until separate environment setup and provider-backed acceptance pass.

Private upload/output reservations, verified sealed R2 objects, ownership checks before signing, RLS, SSRF controls, retention, durable Inngest cleanup, actual checks, and unresolved setup are recorded in [STORAGE.md](STORAGE.md). Storage remains disabled; Cloudflare reports R2 is not enabled, and no hosted storage migration or deployment was performed.

Personal project ownership, RLS, API authorization, rollback, and actual verification are recorded in [OWNERSHIP.md](OWNERSHIP.md). This adds metadata APIs while preserving the finished frontend; generation and object storage are not enabled.

Signup and session verification implementation, staging resource IDs, actual checks, and remaining email/browser gates are recorded in [AUTH.md](AUTH.md). This supersedes the earlier inventory's statement that no authentication code exists. Provider generation and payments remain unimplemented; the entitlement gate is now fail-closed and provider-free.

Shared credit reservation, spend caps, kill switch, worker reconciliation, and unresolved pricing/cap setup are recorded in [SPEND_CAPS.md](SPEND_CAPS.md). The new entitlement route is fail-closed and does not dispatch a provider request.

Cloudflare origin enforcement, shared account limits, disabled checkout, exact proposed edge rules, missing domains, and actual verification are recorded in [EDGE_PROTECTION.md](EDGE_PROTECTION.md). DNS, plan-specific rules, caching, and rollout steps live in [CLOUDFLARE_SETUP.md](CLOUDFLARE_SETUP.md). This code has not replaced the existing staging deployment.

Updated: 5 November 2026. This file records the new app only; Tezu/Krea product decisions stay in their existing notes.

## Public preview preference

Use `https://odhasu.github.io/tezu-homepage/flashloop/blue/` for user-facing previews. The user requires GitHub Pages publication and reaffirmed that preference on 4 November 2026. Local builds are for command-line verification.

## Scope and routes

The supplied `/flashloop-clone/blue/` homepage maps to the independent Flashloop app at `http://localhost:3002/blue`. Its root `/` renders the same homepage. Other product links retain their complete reference URLs, including queries. The root Tezu application and `apps/krea` were preserved.

## Structure

- `src/app/`: root layout, local TikTok Sans font, metadata, `/`, `/blue`, 404.
- `src/components/sites/flashloop/Sections.tsx`: server-rendered hero, model access, assistant preview, cartoon cards, studio cards, audience copy, creator CTA.
- `Composer.tsx`: creation tabs, prompt, local image/video references, model/workflow/settings controls, estimated credits, reference handoff.
- `Galleries.tsx`: release carousel, creator example lightbox, desktop scroll-driven formats, mobile format buttons, trends, FAQ.
- `Media.tsx`: video sources attach within 100px; playback pauses offscreen, on hidden documents, and with reduced motion.
- `SiteShell.tsx`: responsive navigation, keyboard handling, footer.
- `reference-layout.css`: scoped layout reconstructed from observed declarations; excludes unrelated pages and the export's Tailwind/runtime bundles.
- `flashloop.css`: interactive controls, responsive adaptations, accessibility, playback states.
- `content.json`: real reference copy, links, media mapping, FAQs.
- `public/sites/flashloop/`: local assets, including the three Tezu cartoon reference images, owned by this app.

## Optimization and cleanup

Independent dependencies and lockfile avoid changing either existing app's runtime. Root TypeScript/ESLint exclude nested applications; each app checks itself, and CI runs a matrix of all three. Root `dev:*`, `check:*`, and `check:all` commands make ownership explicit.

There are no new animation, icon, or UI-library dependencies. Static sections stay server components; interactive islands hydrate separately. TikTok Sans is self-hosted and preloaded with `next/font/local`. PNG-to-WebP conversion saved 2,090,195 bytes while preserving transparency. Videos use the supplied MP4 previews, defer loading within 100px of the viewport, and release observers/listeners on unmount. The original 88 downloaded assets totaled 56,555,580 bytes before image optimization. Repeated usage shares local URLs.

[assets.json](assets.json) maps each stored asset to its source URL. WebP paths may map to original PNG URLs because conversion occurs locally. Brand assets and reference content retain their original ownership. Generated caches and installed dependencies stay ignored.

## Verification and limits

See [VERIFICATION.md](VERIFICATION.md) for actual checks and limits. This is a frontend recreation with a fail-closed server entitlement gate. Reference files selected in the composer stay on this device; navigation does not upload them. Frontend credit amounts are estimates. Provider generation execution and linked product account services remain disabled or on the reference site. The footer wordmark uses typography rather than the reference's animated particle canvas; five trend tiles cycle through recorded alternate thumbnail states; Hand Drawn keeps its recorded thumbnail. These are explicit fidelity gaps, not provider integrations.

The current audit is recorded in [INVENTORY.md](INVENTORY.md), the isolated service plan in [STAGING.md](STAGING.md), and the frontend baseline in [BASELINE.md](BASELINE.md). The existing Vercel project is a separate runtime surface; staging must use a new Vercel project from `apps/flashloop`.

## GitHub Pages packaging

Set `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage/flashloop` to export. `localPath` prefixes literal images, media, metadata and home links; CSS backgrounds use dynamic root variables for the same prefix. Next.js prefixes its own scripts and font assets. `scripts/audit-export.mjs` validates rendered HTML/CSS destinations against the exported artifact. Product subpages retain the reference site's URLs.

Public deployment verified on 4 November 2026: [release details](VERIFICATION.md#github-pages-release--4-november-2026).
