# Verification record

Updated: 27 October 2026. Results below record completed checks, not guarantees about future changes.

## Affiliate navigation placeholder — 27 October 2026

The user requested Affiliate in the navbar, then clarified that it should not open any link. It appears after Pricing in both menu layouts as a native disabled button. No affiliate page, destination, signup form or program claims were added. Disabled destinations have no click handler or active-selection change; desktop arrow navigation skips them and resolves the next panel using stable item values. Tablet spacing accommodates the sixth entry while preserving action height and typography.

- `npm test`: 21/21 existing tests pass.
- `npm run check` with `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage`: lint, strict TypeScript and static production export pass.
- Export inspection confirms the Affiliate desktop button has `disabled` and no `href` on both public pages, and no `/affiliate/` page exists. Source review confirms the mobile menus use the same disabled destination and keyboard/focus selectors skip it. `git diff --check` passes.
- Product commit: `8eec3f48db9b7454e65bc50c78b9892ed40aaa9f`. [GitHub Pages run 40510839579](https://github.com/odhasu/tezu-homepage/actions/runs/40510839579) successfully checked/built both frontends and deployed. The sibling website and bundled Studio source were preserved.
- Direct downloads of the published homepage and motion-control HTML return HTTP 200 and contain Affiliate as a disabled button without an `href`. These are source/HTTP checks, not browser interaction tests.
- In-app browser automation remains unavailable this turn. No alternate browser or local preview was opened. Tablet fit and desktop/mobile interactions have not been browser-verified for this release.

## Mixed curved gallery and homepage Motion control — 27 October 2026

The user requested a mix of videos and photos in the pictured curved gallery, removal of its three footer buttons and “A few ideas. Endless possibilities.” text, and a larger Motion control feature before Character Swap with the existing white comparison divider.

- The gallery preserves its 11-card order, with six muted looping videos and five still photos/posters. Card sources attach only while eligible and horizontally onscreen; guarded playback pauses offscreen, document-hidden, during its preview, on manual Space pause, or for reduced motion. Hover/focus pauses travel while retaining inline videos. Drag, Left/Right browsing and Enter previews remain available. Full previews use original videos or image/poster files.
- `MotionComparison.tsx` is shared by the existing standalone page and a homepage feature with a maximum 640px frame. It retains the source clips, likes credit, white pointer/keyboard divider and synchronization. Sources load only on playback eligibility. Offscreen/document-hidden/modal states stop playback and the synchronization timer. Reduced motion starts paused; explicit Play remains available.
- `npm test`: 21/21 existing tests pass, including frame scheduling and guarded video pending/rejection/disposal behavior.
- `npm run check` with `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage`: lint, strict TypeScript and static production export pass. `git diff --check` passes.
- Export inspection confirms six video cards/five photo labels, no removed footer/caption, deferred video `src` attributes in both new sections, Motion control before Character Swap, and retained standalone comparison markup. Source review covered effect cleanup, media originals, modal state, keyboard controls and responsive widths.
- Product commit: `efdde962aca7b61db6094868bc00db44b334ffc0`. [GitHub Pages run 40509449322](https://github.com/odhasu/tezu-homepage/actions/runs/40509449322) successfully checked and built the homepage and bundled Studio, then deployed. The sibling website's existing changes and bundled Studio source are preserved.
- Direct downloads of the published homepage and standalone comparison HTML return HTTP 200. Published markup confirms six video cards/five photos, no gallery footer/caption, the larger comparison, and Motion control before Character Swap. These are HTTP/source checks, not browser interaction tests.
- In-app browser automation is unavailable in this turn. No alternate browser or local preview was opened. These results do not establish live playback, desktop/mobile rendering or pointer behavior for this release; those remain pending. Do not reuse screenshots from the preceding performance release as evidence of this change.

## Homepage performance pass — 27 October 2026

Source baseline: `950bcc1`. The user requested code analysis, organization and speed improvements. Existing appearance, media, controls and creation behavior are retained.

| Measured exported resource | Before | After |
| --- | ---: | ---: |
| 31 unique display posters | 4,222,980 B | 599,138 B |
| Header logo | 114,982 B | 7,498 B |
| Poster pixels, estimated RGBA at 4 bytes/pixel | 82,442,496 B | 29,160,960 B |
| Homepage initial modern script files | 676,667 B | 672,168 B |
| Homepage scripts, local gzip estimate | 205,427 B | 203,416 B |
| Motion-control initial modern scripts | 635,875 B | 632,531 B |

Poster transfer size falls 85.8%; dimensions reduce the estimated decoded poster pixels by 64.6%. This pixel calculation is not a measurement of browser/GPU allocation. Full-size assets remain unchanged for previews and references. The generated derivatives preserve aspect ratios and logo transparency.

Modern script totals exclude the 112,594-byte legacy `nomodule` bundle. The WebGL engine is now a deferred chunk requested near its gallery. `node scripts/performance-report.cjs` reproduces export size reports; gzip uses local Node defaults, not observed CDN transfer. Browser tooling did not expose Performance Timing, so no Lighthouse, Core Web Vitals or load-time score is claimed.

- `npm test`: 21/21 pass, including meaningful frame-idling, cancellation/resume, finite easing, autoplay rejection/pending cleanup, thumbnail dimensions/proportions and display-byte-budget checks. New scheduling/playback tests were first run failing before implementation; the thumbnail dimension test failed before bounding both dimensions, then passed.
- `npm run check` with `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage`: lint, strict TypeScript and production export pass.
- Original and derivative contact sheets were visually inspected. The generator is deterministic with fixed inputs and the installed Sharp version; original media and reference URLs are retained.
- Removed the unused displacement-map generator: the current hero CSS already overrides its backdrop-filter rule. The visible glass style remains in CSS.
- Independent scoped reviews found no actionable issues in animation scheduling, lifecycle cleanup, playback eligibility, hero extraction, asset URLs or source preservation.
- Product commit: `c03d7a27779d12a929612f596066a2948b794915`. [GitHub Pages run 40503716839](https://github.com/odhasu/tezu-homepage/actions/runs/40503716839) built the homepage and bundled Studio and deployed successfully. No sibling website or bundled Studio source was changed.
- Live desktop checks on GitHub Pages: all 45 hero display images use thumbnails, no broken images, the header uses the smaller logo, and the gallery engine is absent from the initial load. The engine loads when approaching the galleries; all four canvases initialize. No warning/error console messages were reported during the final review.
- A nonempty hero prompt opens the signup preview with the correct model, resolution and batch. Escape retains the prompt and restores Generate focus. Hero transforms remain unchanged across separate observations while paused by the prompt. Curved-gallery Pause and Next work together; full-image preview uses the original artwork. Lens gallery buttons and keyboard navigation change the selection, and its opened video uses the original source. Character Swap uses thumbnail posters, assigns video sources on eligibility, and opens the original video.
- At 390 × 844, navigation and the MCP Other selection work, gallery controls respond, and the signup dialog fits horizontally (352px wide with 19px margins). Closing retains the draft and restores focus. Homepage and comparison page have no horizontal overflow. Comparison clips decode at 540×960 and 720×1280, play muted, pause, and respond to the divider arrow key (50 to 51).
- Browser verification used only the published github.io pages. Temporary viewport sizing was reset. Live evidence: `C:/Users/User/.codex/artifacts/tezu-live-performance-20261027/desktop-home.png` and `mobile-signup.png`. These checks establish resource usage and retained interactions; they are not load-time, CPU, GPU-memory or Core Web Vitals benchmarks.

## MCP panel cleanup — 27 October 2026

Removed Claude Code from the homepage tabs and shared navigation. Other now uses the existing assistant card styling, with a black background, Suisse type, muted copy and one Connect action. Removed unused clipboard state, ASCII artwork and legacy panel styles. The guide clearly states that connections are coming soon and links to the configured Studio preview.

- `npm test`: 9/9 pass.
- `npm run check` with `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage`: lint, TypeScript and production static export pass.
- `git diff --check`: passes. No Claude Code references remain in public homepage source.
- Independent source review found no actionable React, accessibility, keyboard-tab, responsive CSS or secondary-page selection issues.
- Initial cleanup commit: `68ccb34e3f7d36ac62c78a631446607ec791e24f`. [GitHub Pages run 40494631718](https://github.com/odhasu/tezu-homepage/actions/runs/40494631718) built both frontends and deployed successfully.
- Published desktop checks confirm three tabs, no Claude Code menu option, Other selection from the homepage menu, arrow wrapping and Home/End selection. Connect opens the honest availability guide; Escape and the close button restore focus to Connect. Other from the motion-control page returns to the homepage with the correct tab selected.
- At 390px the card and dialog fit without page overflow. Live testing found that programmatic selection could leave Other partially clipped in the horizontally scrolling tab row. Selection now scrolls the selected tab into view for all input methods while moving focus only for keyboard input. Header selection runs after mobile menu closure, so scrollbar restoration finishes before the row is measured. The follow-up production checks and independent reviews pass.
- Final product commit: `11f75e221416d3cc81a953a3e3ac40c9cb2fc214`. [GitHub Pages run 40495748785](https://github.com/odhasu/tezu-homepage/actions/runs/40495748785) built both frontends and deployed successfully. Live menu selection now leaves Other fully visible: tab right edge 350.59px, row edge 350.67px, scroll offset 72px. The menu closes and the page has no horizontal overflow.
- Live screenshots: `C:/Users/User/.codex/artifacts/tezu-live-mcp-20261027/desktop-other.png` and `mobile-other.png`. Browser review used only github.io; temporary viewport sizing was reset.

## FAQ publication — 27 October 2026

The user requested FAQ sections, GitHub publication and published previews only. Five native `details`/`summary` answers now appear on both the homepage and motion-control page. An independent review found no actionable accessibility, copy or URL issues.

- `npm test`: 9/9 pass.
- `npm run check` with `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage`: lint, strict TypeScript and production static export pass.
- Bundled Studio `npm run check` with its production base path: passes, including 32 prerendered routes. Its initially missing local dependencies were installed with its existing lockfile; no bundled source or manifest was changed.
- GitHub Pages continues to use the existing `main` push workflow, building both the homepage and bundled `apps/tezu` before publishing. Source histories and the separate sibling website are preserved.
- Product commit: `464a75c1b9f2f45ba99490f569dc618711263480`. [GitHub Pages run 40493258556](https://github.com/odhasu/tezu-homepage/actions/runs/40493258556) completed successfully for both build and deploy.
- Browser review used only the public github.io site; no local preview was opened. The published homepage and motion-control page each show five FAQs. Clicking opens answers; Enter closes the focused answer. At 390px the motion-page FAQ answer fits with no horizontal overflow. The FAQ Pricing link opens the published bundled pricing page.
- Both published comparison videos decode successfully and remain muted. Navigation shows MCP, Motion control and Pricing, with the larger login/creation actions. The Cartoon Maker homepage section is absent and Character Swap remains.
- Live evidence: `C:/Users/User/.codex/artifacts/tezu-live-faq-20261027/` contains desktop homepage and mobile motion-page FAQ screenshots. Local source checkout was fast-forwarded to the published source commit; the sibling website and bundled Studio source were preserved.

The previous sections record earlier local checks and their release state at the time. They do not override the latest published-preview preference.

## Navigation and motion-control page — local changes

- `npm test`: existing 9/9 tests pass.
- `npm run check`: ESLint, strict TypeScript and production build pass; `/motion-control` prerenders with the homepage.
- `STATIC_EXPORT=true NEXT_PUBLIC_BASE_PATH=/tezu-homepage npm run build`: passes. The exported page was served locally under `/tezu-homepage/` and checked in the ChatGPT in-app Browser.
- Browser checks at 1440px, 900px, 768px and 390px: responsive header, menu dismissal and no horizontal overflow. Production screenshots inspected at desktop, tablet and mobile widths. Desktop actions measure 48px high; mobile sheet actions measure 56px high. The mobile menu control remains at the right gutter.
- Pricing and Log in navigate to the existing local Studio pages. Start creating focuses the homepage prompt. A Claude selection from the comparison page returns to the homepage with Claude selected. Generate still opens signup and Escape retains the prompt and restores Generate focus.
- Both comparison videos decode and play muted. Pause stops both; Play starts both at matching times. Pointer drag and keyboard Home/End/arrow changes reveal the expected sides. Original 720×1280 and 540×960 videos remain undistorted within the shared cropped stage.
- Source review confirms reduced-motion starts paused, visibility changes pause both clips, manual pause prevents visibility-based resume, and effects clean up. Reduced-motion preference was not emulated in this browser session.
- Independent scoped code review found no actionable issues. `git diff --check` passes.

Evidence: `C:/Users/User/.codex/artifacts/tezu-motion-control-20261027/`. The 450k likes claim was supplied by the user and was not independently verified. No live authentication/generation, commit, push or deployment occurred. The sibling website source and bundled `apps/tezu` were not changed by this task.

## Creation signup frontend repair — local branch

Working copy: `C:/Users/User/Downloads/Tezu-project-2026-10-26/Tezu Websites/tezu-homepage/`, branch `fix/creation-signup-flow`. This repair changes only the homepage; `apps/tezu/` is preserved.

- `npm test`: 9/9 focused regression tests pass. Tests cover whitespace prompt rejection, signup/login field rules, age/terms agreement, deployment URL normalization, invalid overrides, local development links and the production bundled/base-path fallback. The first run against unimplemented validation/destination helpers produced seven expected assertion failures before implementation.
- `npm run lint` and `npm run typecheck`: pass.
- Full `npm run check`: passes lint, strict TypeScript and the Next.js 16.3.5 production build. The homepage and not-found routes prerender successfully.
- GitHub Pages compatibility: a separate `npm run build` passes with `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage`. No deployment was performed.
- `git diff --check`: pass.

The implementation uses a native dialog with explicit close, Escape support, focus restoration, labelled fields, inline validation and a visible frontend availability notice. The form uses `method="dialog"` and prevents submission; Google and email handlers do not send credentials, connect an account or create a generation job. Hero state remains mounted through the dialog lifecycle.

The primary agent verified the frontend in the ChatGPT in-app Browser: Generate opens signup; an uploaded local reference and prompt remain through signup/login switching and Escape; focus returns to Generate; whitespace is rejected; the selected 1080p resolution appears in the draft summary. At 390 × 844 the toolbar fits without horizontal overflow and the dialog fits and scrolls. The temporary viewport override was reset. No live auth/generation submission, commit, push or deployment was performed.

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

In the current homepage repository, use the project's `npm test` and `npm run check` for product changes. The Pages build requires:

```sh
NEXT_PUBLIC_BASE_PATH=/tezu-homepage STATIC_EXPORT=true npm run check
```

The workflow also checks `apps/tezu` with its nested base path. See `.github/workflows/deploy.yml` for the complete publishing steps. Use port 3002 for a new development preview when port 3001 serves the existing static preview.

Recheck the interactions and viewports affected by each change. Record actual outcomes, release identifiers, and evidence locations here. Markdown-only maintenance requires checking links and consistency; it does not require another product build.
