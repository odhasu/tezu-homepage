# Mixed Gallery and Motion Feature Implementation Plan

**Goal:** Show a mix of videos and photos in the curved gallery, remove its three footer buttons and caption, and place a larger Motion control comparison before Character Swap.

**Architecture:** Reuse the current media catalog and guarded playback helper. Share the comparison component between the homepage feature and its existing route. Keep media loading and playback tied to visibility, user intent, reduced motion and modal state.

**Tech stack:** Existing Next.js, React, TypeScript and CSS; no dependencies or backend changes.

## User direction and implementation choices

- The supplied screenshot identifies the curved gallery. Remove its previous/pause/next buttons and the exact “A few ideas. Endless possibilities.” text.
- Keep a deliberate mixture of existing video clips and still photos. Full previews use original media, while cards retain small poster derivatives.
- Interpret the unfinished “with the wh” as the existing white draggable comparison divider, following the user's earlier request.
- Treat Motion control as the first showcase feature, immediately before Character Swap. Use the existing dark typography and a larger comparison frame on the homepage. Preserve the separate comparison route.
- Retain drag, keyboard browsing, focus/hover pause, Space to pause, and reduced-motion support after removing visible gallery controls.
- Browser review and user-facing URLs use GitHub Pages only. Preserve the sibling website, bundled Studio, current branch and unrelated changes.

## Tasks

- [x] Curved gallery: implement mixed cards and full video/image previews; remove the footer; preserve efficient scheduling, visibility-gated playback and keyboard access. Ownership: gallery component/CSS and any focused gallery helper/tests.
- [x] Comparison: extract the shared comparison, add a homepage variant with larger frame, and preserve standalone behavior. Gate loading/playback offscreen and keep the white pointer/keyboard divider. Ownership: comparison component, MotionControlPage and motion-control CSS.
- [x] Composition: place the homepage feature before Character Swap; review both independent changes and update current instructions/documentation.
- [ ] Run existing tests and production checks; review affected lifecycle/keyboard/media behavior. Publish, verify desktop/mobile on GitHub Pages, save screenshots and record release results.

## Verification

Check a visible mix of video and image cards, muted video playback, offscreen/modal/reduced-motion pause, arrow/Space browsing, original full previews and Escape. Confirm no gallery footer or removed copy, comparison ordering and divider interaction, no horizontal overflow, and intact signup/navigation. Record actual evidence in `docs/VERIFICATION.md`.

21 tests and the production checks pass. Exported markup confirms the media mix, removed footer/copy, deferred sources and section order. In-app browser automation is unavailable in this turn; desktop/mobile and live interaction verification remains pending. Do not mark those checks complete based on source inspection.
