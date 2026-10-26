# Tezu motion galleries

The main homepage gains four galleries between the app integrations and the existing Cartoon Maker / Character Swap sections. The user requested a random mix of existing Tezu images and videos in all four. The newer homepage hero, curved media gallery, app integrations, and tool sections remain intact.

| Reference | Local destination | Recreated behavior |
| --- | --- | --- |
| https://bencho.dev/finds/colton-lens-scroll | Homepage, Lens gallery | Vertical media column, optically flat middle and flared edges; wheel, mouse drag and buttons advance the column. |
| https://bencho.dev/finds/marcelodesignx-bending-reel | Homepage, Bending reel | Horizontal band pinched at its center and flared at its edges; drag and arrow controls. |
| https://bencho.dev/finds/basit_designs-folding-cards | Homepage, Folding gallery | Horizontal media passing a fixed curved fold, with changing surface light. |
| https://www.scrolltide.co/components#c-arc-carousel | Homepage, Arc gallery | Cards follow a circular arc, tilting tangent to it, with the selected card upright near the apex. |

These are original interactive implementations based on the public motion references. The references are video demonstrations, not distributable source code. No reference video, production bundle, or paywalled code is embedded in the site.

## Ownership

- `TezuMotionGalleries.tsx`: scene composition, drag, keyboard and buttons, lazy initialization, full-size dialog.
- `motion-gallery-engine.ts`: tessellated WebGL media surfaces, deformation and arc geometry, playback, resize and cleanup.
- `motion-gallery-media.ts`: deterministic shuffled media selections, each with six videos and three images.
- `tezu-motion-galleries.css`: two columns on desktop, one column below 900px, scoped styling.
- `KreaHomePage.tsx`: additive insertion into the existing page.
- Media comes from the existing `tezu-media.json` / `public/sites/tezu/` assets. No new external media dependency.

## Interaction and fallback

Visible galleries drift slowly and play only nearby selected videos. Pause stops drift and video playback. Offscreen scenes, hidden browser tabs, and the full-size preview pause background playback. Reduced-motion preference disables autoplay, wheel-driven changes, and release inertia; arrow navigation changes selection immediately. Native media cards remain available when WebGL cannot initialize. Opened previews use the original dimensions and contain the entire media.

Use arrow keys to browse, Home/End for the first/last item, Enter/Space to open, and Escape to close the native dialog. Horizontal touch gestures browse while vertical gestures preserve page scrolling. Each gallery has previous, next, pause, and preview controls.

## Verification

Run `npm run check` with the GitHub Pages base path before deployment. Browser checks cover all four active renderers, desktop/mobile sizes, drag and keyboard selection, pause, preview dimensions and dismissal, horizontal overflow, console errors, and compatibility with the newer homepage sections. The lens/fold/reel warp functions are reconstructions of the observed motion, not an assertion of identical source shader equations.

Verified on 26 October 2026: lint, strict TypeScript, and the GitHub Pages production export pass. Chromium rendered all four WebGL scenes at 1440×1000 and mobile widths of 390px and 320px without horizontal overflow or page errors. Pause, previous/next, Home, arrow keys, drag, preview dimensions, Escape dismissal, and reduced-motion behavior pass. Screenshots and the browser verification report are saved in the local `tezu-motion-galleries-20261026` artifact folder.
