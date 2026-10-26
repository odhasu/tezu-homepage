# Tezu homepage motion update

## Reference map

- Scrolltide `https://www.scrolltide.co/components#c-media-gallery`: the public preview shows portrait cards on a shallow concave ring. Center cards are smaller; the edges turn inward and grow toward the viewer. Recreate this geometry in editable React and CSS using local Tezu images. The paid prompt is not needed or accessed.
- Aura `https://www.aura.build/create`: heading words rise 16px, fade from transparent, and sharpen from a 4px blur over 700ms, with 80ms staggering. Prompt examples use staggered character reveals and cycle while empty.
- Both references map to `/` in `apps/krea`; the repository-root Tezu routes remain intact.

## Design decisions

Keep the existing palette: black `#000000`, page `#101010`, surface `#242424`, muted `#a3a3a3`, text `#ffffff`. Keep Suisse Intl for all roles. The hero heading uses medium weight, tight tracking, and a responsive 36–68px scale. No new accent color or decorative labels.

The page has a centered hero and composer over the existing image wall. The wall drifts horizontally to the right at 9px/s. A full-width curved image strip bridges the hero and integrations. Video headings and descriptions align left; actions align right. Results are separated into Cartoon Maker and Character Swap, with actual video previews below each title.

The gallery is the main visual addition. Other motion supports the requested text treatment, with no welcome interstitial or zoom sequence. Reduced motion presents readable text and static images without autoplay. Gallery buttons provide an alternative to dragging; native dialogs support Escape and focus restoration.

## Ownership

All product changes live under `apps/krea/src`. Project-specific instructions live in `apps/krea/AGENTS.md`. Existing local media and fonts are reused. No new runtime dependencies are required.

## Verification

Completed on 25 October 2026. `npm run check` passed ESLint, TypeScript, and the Next.js production build in `/private/tmp/tezu-motion-preview.nosync`. All 11 changed source files were compared against the canonical workspace and matched exactly. The local runtime avoids iCloud placeholder reads; it serves the updated preview on port 3002.

Browser verification covered 1440px desktop and 390px mobile layouts, with no horizontal overflow or broken images. Gallery dragging moves the cards without opening a preview; buttons and image dialogs work. Cartoon and Character Swap video dialogs load successfully. Offscreen videos load only when needed. Reduced motion disables autoplay and makes text immediately readable. Mobile navigation, prompt editing, and playback pause controls were checked.

Screenshots are saved in `docs/design-references/tezu-homepage-motion/`: `desktop.png`, `gallery-desktop.png`, `cartoon-maker-desktop.png`, `full-desktop.png`, and `mobile.png`.

## Published repository

In `odhasu/tezu-homepage`, the canonical `apps/krea` homepage maps to the repository root. The older application is preserved in `apps/tezu`. GitHub Pages builds both apps and publishes the older application under `/tezu/`.
