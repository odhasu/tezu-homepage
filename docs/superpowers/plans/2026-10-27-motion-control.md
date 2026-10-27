# Tezu navigation and motion-control page

**Goal:** Apply the user's navigation changes and show their two videos in a draggable comparison on a separate black page.

**Design:** Preserve the Tezu knot, Suisse type, existing header and remaining galleries. Add Pricing to the existing Studio pricing route; rename Apps to MCP. Replace the standalone Cartoon Maker navbar entry with Motion control. Remove the Cartoon Maker section from the homepage while retaining Character Swap and the original media files. Enlarge Log in and Start creating. The new `/motion-control/` page uses a pure black background, the supplied viral-result video on the left, the existing template video on the right, and a white divider/round drag handle based on the screenshot. Show the user-supplied “450k likes” claim with the viral clip. Provide pause/play, keyboard comparison and reduced-motion support.

**Architecture:** Next.js static route plus one scoped client comparison component. Use existing base-path-aware assets and app URL resolver. No new libraries, provider calls or backend work.

**Constraints:** Use existing checkouts and repair branches. Preserve previous work. Initial delivery was local only; the subsequent user request on 27 October authorizes committing, pushing and GitHub Pages deployment, adds FAQs on both pages, and requires published previews only. Browser verification uses only the ChatGPT in-app Browser.

- [x] Navigation agent owns `TezuSiteHeader.tsx` and `SiteHeader.module.css`: update labels/destinations, support links back to homepage from a secondary route, enlarge actions responsively.
- [x] Comparison agent owns `src/app/motion-control/page.tsx`, `MotionControlPage.tsx`, and `motion-control.css`: implement the comparison and playback controls with static metadata.
- [x] Primary agent owns `TezuShowcase.tsx`, new source media/posters, and documentation: remove only the Cartoon Maker homepage section, inspect/import media, integrate the work.
- [x] Verify: existing `npm test`, `npm run check`, GitHub Pages base-path export, desktop/mobile navigation, comparison drag/keyboard, pause/reduced motion, media load and retained signup draft behavior.

**Review focus:** both clips use the same stage geometry; no distortion; unavailable autoplay leaves usable controls; divider accepts touch and keyboard; secondary-page links return to the correct homepage section; no mobile horizontal overflow; all asset links include the configured base path.
