# Homepage performance implementation plan

**Goal:** Reduce initial image transfer, decoded preview memory and idle rendering while preserving the published design and creation flow.

**Architecture:** Keep original artwork and media as the full-preview/reference source. Generate bounded display thumbnails, load the WebGL renderer near its section, and schedule hero/carousel frames only while work is needed. Separate hero state from page composition.

**Scope:** Homepage repository only. Preserve the sibling website, bundled Studio, routes, media proportions, keyboard controls and current animation designs. Browser verification uses GitHub Pages only.

## Baseline

- Exported homepage script tags: 789,261 bytes including the legacy-only bundle. Modern-browser initial scripts: 676,667 bytes, approximately 205,427 bytes with Node's default gzip settings.
- Hero: 45 image tiles, 31 unique original posters totaling 4,222,980 bytes. Two character PNGs contribute 2,976,626 bytes.
- Hero writes dimensions, visibility and transforms every frame even while paused; curved gallery also requests frames while idle/offscreen.
- Gallery source already gates videos and WebGL drawing by visibility. Preserve those controls.

## Tasks

- [x] Generate reproducible WebP display assets and a base-path-aware manifest; retain original source/reference URLs. Compare source and derivative artwork visually.
- [x] Stop idle/offscreen hero frames, cache size-dependent writes, and verify drag/keyboard/hover settling with focused regression tests.
- [x] Stop idle curved-gallery frames, defer the renderer import until nearby, and prevent repeated pending/rejected autoplay requests. Test the extracted scheduling/playback logic.
- [x] Extract `TezuHero.tsx`; remove the unused displacement-map effect whose visual rule is overridden. Wire display thumbnails into hero/gallery/header/showcase while retaining original previews.
- [x] Run tests and production checks, compare exact asset/bundle budgets, review the integrated diff, publish, then verify signup, navigation, galleries, previews and comparison on desktop/mobile. Release `c03d7a2`, successful Pages run `40503716839`; results are recorded in `docs/VERIFICATION.md`.

## Verification limits

Static byte counts and lifecycle behavior are directly measurable here. Browser tooling does not expose Performance Timing, so do not claim Lighthouse or Core Web Vitals scores without a supported measurement. Record generated asset bytes separately from actual network transfer.
