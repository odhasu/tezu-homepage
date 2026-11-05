# Flashloop inventory

Updated: 4 November 2026.

This audit records the finished Blue frontend, its published copy, the separate Vercel deployment, and the service access visible from this workspace. It is an inventory, not a production security review. No secret values were read or written.

## Source and deployment identity

| Surface | Identity | Current state |
| --- | --- | --- |
| Authoring source | `apps/flashloop` in `/Users/oscargraafmans/Desktop/ai-website-cloner-template` | Next.js 16.3.5, React 19.2.4, TypeScript strict, Node `>=24`; local working copy matches the deployment checkout for sampled source hashes. |
| Published Blue preview | [GitHub Pages](https://odhasu.github.io/tezu-homepage/flashloop/blue/) | Static export from `odhasu/tezu-homepage`; product commit `45b37cbd56b1010e6e659313692f0729dac31e7d`, release documentation commit `a161e32a1bd6e0956575ad0d4a849e51adae92d1`. |
| Original supplied reference | [flashloop-clone Blue](https://odhasu.github.io/flashloop-clone/blue/) | Separate static reference. Local product links intentionally keep pointing here for product pages that are outside this clone. |
| Existing Vercel project | `odhasus-projects/flashloop`, alias [flashloop-teal.vercel.app](https://flashloop-teal.vercel.app/) | Linked to private GitHub repository `odhasu/tezu-website`, production branch `main`; deployment `flashloop-6wfk1nraf-odhasus-projects.vercel.app` at commit `93bdfbce92f0fbd32846476f4c7353ec00a9b079`, created 2 November 2026. Root route returns 200; `/blue/` returns 404. Its rendered markup and runtime behavior differ from the GitHub Pages Blue export. |

The workspace root is on branch `master` with unrelated uncommitted Tezu/Krea work. It has no Vercel link file. The existing Vercel project must not be linked into this checkout or used as staging. The staging target is a new Vercel project built from `apps/flashloop`.

## Frontend routes and behavior

The editable app has three route outcomes:

- `/` re-exports the Blue homepage.
- `/blue` renders the Blue homepage.
- Unknown paths render the local 404 page.

The static export is enabled only when `STATIC_EXPORT=true`; GitHub Pages also sets `NEXT_PUBLIC_BASE_PATH=/tezu-homepage/flashloop`. The app has no middleware, no route handlers, no server actions, and no dynamic route files. The compiled App Router manifest contains only `/`, `/blue`, and the not-found routes.

The current Flashloop clone uses scoped CSS (`reference-layout.css`, `flashloop.css`, and `globals.css`) rather than a Tailwind dependency or Tailwind config. The requested Next.js/TypeScript/Tailwind stack is therefore a staging direction, not a claim about the finished published source. Preserve the CSS baseline while introducing Tailwind incrementally; do not rewrite the finished UI during inventory work.

The finished UI provides local behavior for:

- Video/Image tabs, model and workflow pickers, generation settings, prompt entry, estimated credits, and keyboard interactions.
- Local reference image/video previews. Files are type-checked, capped at 30 MB, limited to four attachments, and held in object URLs on the device. They are never uploaded by this app.
- Release carousel, creator media lightbox, scroll-driven format gallery, mobile format buttons, trend thumbnail cycling, FAQ disclosure, mobile navigation, lazy media loading, reduced-motion handling, and visibility-aware video playback.
- Prompt submission as navigation to the reference site's create URL. It does not create media locally.

Content is bundled in `src/components/sites/flashloop/content.json`. The 93 local assets are under `public/sites/flashloop/`; `docs/assets.json` records provenance. The app has no database model, user record, credit ledger, upload store, job queue, or payment adapter in the published Blue frontend. The editable runtime includes consent-gated PostHog relay and Sentry boundaries, but both remain disabled until their separate staging configuration and privacy approval are supplied; see [ANALYTICS.md](ANALYTICS.md) and [OBSERVABILITY.md](OBSERVABILITY.md).

## Backend and integration inventory

### Editable Blue source and GitHub Pages

No backend endpoints exist. Auth, payments, email, generation, uploads, and live MCP/ChatGPT connection are absent. Product links leave the clone for the original reference site. The GitHub Pages artifact is static and cannot execute Next.js Route Handlers.

### Existing Vercel deployment

The Vercel app is a separate runtime surface. Client bundles reference these endpoint families:

| Endpoint family observed in deployed client bundles | Read-only probe result |
| --- | --- |
| `/api/auth/providers` | `200`, returns no email or social providers. |
| `/api/auth/session` | `503`, `Service is temporarily unavailable. Please try again.` |
| `/api/auth/signout`, `/api/auth/social/:provider`, `/api/auth/:action` | Referenced by the auth client; no sign-in or sign-out action was attempted. |
| `/api/storage/upload`, `/api/storage/complete` | `405` to an unauthenticated `GET`, indicating method-specific handlers. |
| `/api/storage/assets`, `/api/storage/download?assetId=...` | Asset client references observed; `/api/storage/assets` returned `503` without a session. |
| `/api/creation-drafts`, `/api/image-generations` | Client references observed; unauthenticated `GET` returned `503`. |
| `/api/workspace` | Client references observed; unauthenticated `GET` returned `503`. |

These probes map public behavior only. They do not establish authorization, RLS, upload safety, provider security, or production readiness. No mutation request, login, file upload, generation, or payment action was performed.

The deployed client also advertises `https://mcp.flashloop.ai/mcp`. This project keeps the live ChatGPT/MCP connection deferred, per the task request.

The existing Vercel root response includes `Cache-Control: public, max-age=0, must-revalidate`, `x-nextjs-prerender: 1`, `x-nextjs-stale-time: 300`, `x-vercel-cache: PRERENDER` or `HIT`, HSTS, `X-Frame-Options: DENY`, and a restrictive Content Security Policy. These are observed deployment headers, not a substitute for the staging cache and security policy in [STAGING.md](STAGING.md).

### Vercel configuration observed

The authenticated Vercel CLI account is `odhasu`; team `odhasus-projects` is visible. Existing project environment-variable names are:

- `AWS_RESOURCE_ARN` (secret, Preview and Production)
- `AWS_ACCOUNT_ID` (secret, Preview and Production)
- `AWS_ROLE_ARN` (secret, Preview and Production)
- `S3_BUCKET_NAME` (secret, Preview and Production)
- `AWS_REGION` (secret, Preview and Production)
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_FLASHLOOP_THEME`
- `NEXT_PUBLIC_BASE_PATH`

No Supabase, Cloudflare R2, Inngest, Sentry, PostHog, or AI-provider variable appeared in that project listing. The AWS/S3 variables belong to the existing Vercel deployment and must not be copied into the new staging project.

## Service access audit

| Service | Evidence from this workspace | Staging conclusion |
| --- | --- | --- |
| Vercel | CLI authenticated; existing team and `flashloop` project readable. Local source is not linked. | Create a separate staging project from `apps/flashloop`; do not relink or mutate production. |
| Supabase | Connected account exposes organization `lukas` and one active project named `lucasresellzcodex`, unrelated to Flashloop. | Create a dedicated Flashloop staging project. Do not reuse the visible project. |
| Cloudflare | Connected account is readable. R2 bucket listing returned HTTP 403, code `10042`: “Please enable R2 through the Cloudflare Dashboard.” | Enable R2, then create a staging-only bucket and scoped token. No bucket was created. |
| Inngest | Tool descriptors are present, but account/environment calls returned `Unknown tool`; no app or environment was verified. | Create or confirm a staging environment before adding event keys or signing keys. |
| Sentry | Server SDK and privacy-gated integration are present; no DSN or hosted project was configured. | Create a staging project and add a DSN only after the runtime and privacy boundary are approved. |
| PostHog | Consent-gated server relay is present; no token, destination or hosted project was configured. | Create separate staging and production projects, verify region and retention, then configure only the selected environment. |
| AI providers | No provider credential or provider SDK is in the editable app or existing Vercel env listing. | Select providers, issue staging keys with spend limits, and keep provider calls server-side. |
| Whop payments | No integration. | Deferred. Do not add payment keys or checkout routes in staging. |
| Live ChatGPT/MCP | Static Blue source has no connection; deployed client advertises an external MCP URL. | Deferred. Do not connect or test a live account from this staging plan. |
