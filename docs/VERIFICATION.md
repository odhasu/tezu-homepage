# Verification record

Updated: 26 October 2026. Results below record completed checks, not guarantees about future changes.

## Resend-style navbar — `5ff13fa`

- `npm run check` passed lint, TypeScript, and the static production build with `NEXT_PUBLIC_BASE_PATH=/tezu-homepage STATIC_EXPORT=true`.
- GitHub Actions [run 40329779223](https://github.com/odhasu/tezu-homepage/actions/runs/40329779223) successfully built both applications and deployed Pages.
- Browser verification passed locally and on the live homepage.
- Desktop widths: 1440, 1920, 1024, 900, and 768px. Mobile widths: 390, 320, and 767px.
- Verified: desktop/mobile bar sizes, centered maximum width, hover dropdowns, keyboard entry and Escape focus, Tezu tool destinations, mobile back navigation and focus restoration, Claude integration selection, menu dismissal, body scroll restoration after closing/resizing, reduced motion, retained galleries, and no horizontal overflow or page errors.

Local evidence directory: `/Users/oscargraafmans/.codex/artifacts/tezu-resend-navbar-20261026/`.
Live report: `live/verification.json`. Desktop/mobile screenshots are in `live/`; source screenshots are in `source/`. `desktop-comparison.jpg` and `mobile-comparison.jpg` compare the reference and implementation.

## Four motion galleries — `c8f2e56`

- Lint, strict TypeScript, and the GitHub Pages production export passed.
- GitHub Actions [run 40302288792](https://github.com/odhasu/tezu-homepage/actions/runs/40302288792) deployed successfully.
- Browser verification passed locally and live at 1440×1000, 390×844, and 320×740.
- All four WebGL renderers initialized. Verified pause, previous/next, Home and arrow keys, drag, preview source dimensions, `contain` fitting, Escape dismissal, reduced-motion behavior, and absence of overflow or page errors.

Local evidence directory: `/Users/oscargraafmans/.codex/artifacts/tezu-motion-galleries-20261026/`. The `live/` directory contains `verification.json` and `all-four-galleries.png`.

## Running future checks

In the deployment checkout, use the project's `npm run check` for product changes. The Pages build requires:

```sh
NEXT_PUBLIC_BASE_PATH=/tezu-homepage STATIC_EXPORT=true npm run check
```

The workflow also checks `apps/tezu` with its nested base path. See `.github/workflows/deploy.yml` for the complete publishing steps. Use port 3002 for a new development preview when port 3001 serves the existing static preview.

Recheck the interactions and viewports affected by each change. Record actual outcomes, release identifiers, and evidence locations here. Markdown-only maintenance requires checking links and consistency; it does not require another product build.
