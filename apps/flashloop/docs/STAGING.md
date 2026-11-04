# Flashloop staging plan

Updated: 4 November 2026.

Staging target: a new Vercel project built from `apps/flashloop`, preserving the finished Blue frontend. Existing GitHub Pages and the existing Vercel `flashloop` project remain untouched. Staging must never charge production accounts, consume production AI quotas, write production data, or publish over the current Pages release.

## Isolation boundary

| Resource | Staging boundary | Production boundary |
| --- | --- | --- |
| Vercel | New project, for example `flashloop-staging`; separate Preview/Production environment values; optional Vercel Authentication. | Existing `odhasus-projects/flashloop` project and its current aliases. |
| Supabase | New project, separate database, Auth tenant, redirect URLs, test users, migrations, and RLS policies. | No connection from staging. |
| Cloudflare R2 | New bucket, for example `flashloop-staging-media`; separate API token, CORS, lifecycle, and public hostname. | No production bucket or token. |
| Inngest | Staging branch environment and app ID, for example `flashloop-staging`; staging event and signing keys. | Production app and keys remain out of staging. |
| AI providers | Provider-specific staging keys with hard spend and rate limits, or a no-op adapter for UI work. | Production keys are never copied into Vercel Preview or local files. |
| Sentry | Separate staging project or environment tag; sample errors only. | Production project receives no staging traffic. |
| PostHog | Separate staging project or explicit `environment=staging` property with opt-in capture. | Production analytics remains isolated. |
| Payments and live MCP | No keys, routes, callbacks, or account connection. | Deferred until separately authorized. |

## Environment-variable catalog

Names below are proposals for the implementation phase. Values belong in Vercel or a local secret manager and are intentionally absent from this repository.

### Public/runtime configuration

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_BASE_PATH`
- `NEXT_PUBLIC_FLASHLOOP_THEME`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_R2_PUBLIC_URL` (only if browser-readable media is intentionally public)
- `NEXT_PUBLIC_SENTRY_DSN` (only if browser error reporting is enabled)
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`

### Server-only configuration

- `SUPABASE_SERVICE_ROLE_KEY` or the current Supabase server secret-key name selected from the installed SDK documentation; never expose it to the browser.
- `CLOUDFLARE_ACCOUNT_ID`
- `R2_ENDPOINT`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BASE_URL` (if server-generated URLs use a public media host)
- `INNGEST_EVENT_KEY`
- `INNGEST_SIGNING_KEY`
- `INNGEST_ENV`
- `INNGEST_DEV` (local development only; do not set to `1` in Vercel production)
- `SENTRY_DSN`
- `SENTRY_AUTH_TOKEN` (build/release use only)
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `POSTHOG_API_KEY` (server-side ingestion or feature-management use only)
- `POSTHOG_PROJECT_ID`
- Provider-specific AI variables selected after provider approval, such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `FAL_KEY`, or `REPLICATE_API_TOKEN`.

The existing Vercel `AWS_*` and `S3_BUCKET_NAME` variables are not staging variables for this plan. Do not copy them into the new project.

## Implementation order

1. Freeze the frontend baseline and retain the current Pages release commit. Create a branch or worktree for staging changes; do not reset unrelated root changes.
2. Create the new Vercel project from `apps/flashloop`. Leave `STATIC_EXPORT` unset so future Route Handlers can run there. Keep the GitHub Pages workflow using `STATIC_EXPORT=true` and its existing base path.
3. Keep the finished scoped CSS as the visual baseline. Add Tailwind CSS only as an incremental, verified layer; do not replace the emulation styles while backend seams are being staged. Add an env-name template and a startup check that reports missing variable names without printing values. Add CI checks that reject production hostnames, production bucket names, production Supabase references, and live payment/MCP variables in staging.
4. Provision a new Supabase project. Add schema migrations, Auth redirect URLs for the staging host, test users, and RLS policies. Use the publishable key in the browser; keep privileged keys server-only. Verify with a staging-only test query.
5. Enable Cloudflare R2 and create the staging bucket. Add scoped read/write credentials, upload size/type limits, object ownership checks, CORS, lifecycle cleanup, and a staging media hostname. Verify upload and download using a disposable test object.
6. Add Next.js Route Handlers for session, upload intent/completion, drafts, and generation requests. Validate auth, ownership, content type, size, idempotency, and rate limits before calling a provider. Keep provider credentials out of client components.
7. Add Inngest staging functions for long-running generation and cleanup. Use the staging environment and keys; exercise retries against test objects only.
8. Add AI provider staging keys or a no-op adapter. Set hard quotas and a provider allowlist. Do not enable billing or production account access.
9. Add Sentry and PostHog staging telemetry. Tag events and errors with `environment=staging`; redact prompts, tokens, uploaded content, and user identifiers unless explicitly required.
10. Add HTTP caching after auth/data behavior is verified: immutable caching for versioned public assets, short `s-maxage` plus `stale-while-revalidate` for public marketing data, and `private, no-store` for auth, drafts, uploads, and user media responses. Recheck Vercel and browser cache headers.
11. Run the frontend checks, Route Handler tests, staging smoke flow, and a production-key scan. Keep the public Pages URL as the visual comparison baseline.

## Acceptance gates

- Staging URL is a new Vercel project and does not alias the current production project.
- Supabase project, R2 bucket, Inngest environment, Sentry project, PostHog project, and AI provider keys are staging-specific.
- A staging smoke test can sign in with a test user, upload a disposable object, create a draft, enqueue a no-cost test job, and clean up without touching production data.
- No payment key or Whop route exists. No live ChatGPT/MCP connection is used.
- Logs, screenshots, and notes contain environment names and resource IDs only where useful; never secret values, tokens, signed URLs, or private prompt/media content.
- A failed mock, static export, or local test is not treated as proof of production security. Security claims require provider-backed tests and review.

## Rollback

1. Stop staging traffic by disabling the staging Vercel alias or promoting the previous staging deployment. Never roll back the production `flashloop` alias from this worktree.
2. Disable staging Inngest functions and revoke only staging event/signing keys if a job or provider integration misbehaves.
3. Revert the staging branch or promote the last known-good staging deployment. Keep the GitHub Pages deployment checkout at its recorded release unless a separate release rollback is requested.
4. Restore staging Supabase from its migration backup or point-in-time recovery. Remove only staging test rows and R2 objects; do not run cleanup against production identifiers.
5. Revoke staging R2 and AI credentials, Sentry auth token, and PostHog server key if exposed. Rotate affected staging credentials without printing them.
6. Record the failed deployment ID, resource boundary, test evidence, and recovery result in the staging notes.

## Missing setup

Current access confirms Vercel CLI and Cloudflare account identity, but no Flashloop Supabase project, R2 bucket, verified Inngest environment, Sentry project, PostHog project, or AI provider staging credentials. The service-creation steps above remain pending until those resources are intentionally provisioned.
