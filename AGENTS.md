<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Tezu homepage

The repository root owns the current image-wall Tezu homepage. The older Tezu application remains in `apps/tezu`. Do not replace one with the other. The canonical authoring workspace keeps this homepage under `apps/krea`; publishing maps that app to this repository root.

## User-approved direction

- Keep the Tezu knot logo, dark visual identity, and existing Suisse Intl fonts.
- Show the prompt immediately. Do not restore the "Welcome to Tezu" screen or the full-screen zoom entrance.
- Match the upward, softly blurred text reveals from https://www.aura.build/create for the hero heading and rotating prompt examples. Stop prompt rotation while the user types.
- Move the image-wall background slowly to the right. Pause it during interaction with the prompt and respect reduced-motion preferences.
- Use https://www.scrolltide.co/components#c-media-gallery as the visual reference for a gallery that curves around the viewer. Mix local Tezu videos and photos; keep drag and keyboard browsing with Space to pause. The user removed the three footer buttons and the “A few ideas. Endless possibilities.” caption on 27 October 2026.
- Keep the content order: hero, curved media gallery, MCP integrations, the four motion galleries, a larger Motion control comparison, Character Swap with template videos, then FAQs. The homepage comparison uses the same white divider and supplied clips as the separate motion-control route. Preserve original media.
- Preserve the source aspect ratios of videos. Gallery thumbnails may crop to portrait frames; opened previews must show the full image.
- Keep existing app integrations, navigation, and linked Tezu tools working. Do not add live AI generation, authentication, or payments as part of visual work.

## Files and checks

- `src/components/sites/krea/KreaHomePage.tsx`: hero and page composition.
- `ImageWall.tsx`: background motion and image selection.
- `MediaGallery.tsx` and `media-gallery.css`: curved image gallery.
- `AnimatedText.tsx` and `text-motion.css`: text reveals and rotating prompt examples.
- `TezuShowcase.tsx` and `tezu-showcase.css`: cartoon and template video sections.
- Run `npm run check` in this app and compare desktop and mobile renders before delivery.
- Show previews and verify browser behavior on `https://odhasu.github.io/tezu-homepage/` using the ChatGPT in-app Browser. The user requested GitHub Pages publication and no local preview URLs on 27 October 2026. Local command-line builds and checks remain available.
- Use `npm run dev -- --port 3002` when port 3001 is serving the existing static preview. Do not overwrite or stop unrelated previews.
- Some Desktop files may be iCloud placeholders. Prefer verified existing local copies for recovery; never treat an unread placeholder as an empty file.

## Persistent project notes

- The user requests more `.md` documentation. Read `docs/README.md`, `docs/STATUS.md`, and the relevant research brief before continuing project work.
- Keep `docs/STATUS.md`, `docs/DECISIONS.md`, and `docs/VERIFICATION.md` current after meaningful work. Record actual checks, release state, and evidence; label proposals and unverified assumptions.
- Link existing research instead of duplicating it. New user instructions supersede historical notes. Never store credentials in documentation.
