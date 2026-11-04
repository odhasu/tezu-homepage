# Flashloop frontend baseline

Captured: 4 November 2026, Europe/Amsterdam.

This baseline supports visual and behavior comparison before backend work. Screenshots were captured in the Codex browser at 1280 × 720 during the audit. The captures showed the pages listed below; no local source or deployed resource was changed.

## Screenshot captures

1. [Published Blue clone](https://odhasu.github.io/tezu-homepage/flashloop/blue/) — static GitHub Pages export. Header contains Explore, Image, Video, MCP, Creator Program, Pricing, Login, and Sign up. Hero composer defaults to Video and shows the local-reference prompt.
2. [Local authoring server](http://localhost:3002/blue) — Next.js 16.3.5 development server from `apps/flashloop`. Accessibility tree and hero match the published Blue surface; local footer links point to the reference site.
3. [Existing Vercel deployment](https://flashloop-teal.vercel.app/) — separate runtime app. Hero is visually similar but shows `Save draft`, `Upload text references`, and internal Vercel links. This capture is not the source of truth for the published Blue clone.

The public Blue, local authoring, and Vercel screenshots are intentionally recorded together to prevent accidentally treating the existing Vercel project as the newer GitHub Pages release. A complete fresh mobile screenshot comparison was not recorded; existing verification notes document that limitation.

## Behavior baseline

| Area | Published Blue clone | Existing Vercel app |
| --- | --- | --- |
| Homepage URL | `/tezu-homepage/flashloop/blue/` | `/` |
| `/blue/` | 200 on GitHub Pages | 404 after redirect from `/blue` |
| Composer | Local preview; Create action navigates to reference site; file previews remain local | Draft-oriented client UI; route handlers are referenced by bundles but several unauthenticated reads returned 503 |
| Auth | No local auth | `/auth/` exists; `/api/auth/providers` returned 200 with no providers; session returned 503 |
| Uploads | No upload request | Storage endpoint families referenced; unauthenticated GETs returned 503 and upload/complete GETs returned 405 |
| Generation | No local generation | `/api/image-generations` and `/api/creation-drafts` referenced; unauthenticated reads returned 503 |
| MCP | Local preview only; live connection deferred | UI advertises external `https://mcp.flashloop.ai/mcp`; connection not tested |

## Published release evidence

- GitHub Pages HTTP status: 200.
- `apps/flashloop/docs/pages-verification.json`: 103 route/asset destinations checked, no failures.
- Page title: `Flashloop - AI Video & Image Generator`.
- Product commit: `45b37cbd56b1010e6e659313692f0729dac31e7d`.
- Deployment documentation commit: `a161e32a1bd6e0956575ad0d4a849e51adae92d1`.
- Existing local verification: `npm run check --prefix apps/flashloop`, asset audit, and production build passed on 4 November 2026. Re-run after staging code changes.

## Known fidelity limits

The footer wordmark uses typography rather than the original particle canvas. Five trend tiles cycle through recorded alternate thumbnails; Hand Drawn keeps its recorded thumbnail. Video playback and motion are intentionally approximations. These are visual fidelity notes, not backend behavior.

The local development browser emitted one React warning about a duplicate footer link key (`https://odhasu.github.io/flashloop-clone/blue/create/video/`). Production lint, typecheck, asset audit, and build still pass. This warning is recorded for later cleanup and was not changed during staging inventory.
