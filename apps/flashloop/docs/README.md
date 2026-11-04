# Flashloop implementation notes

Updated: 4 November 2026. This file records the new app only; Tezu/Krea product decisions stay in their existing notes.

## Public preview preference

Use `https://odhasu.github.io/tezu-homepage/flashloop/blue/` for user-facing previews. The user requires GitHub Pages publication and reaffirmed that preference on 4 November 2026. Local builds are for command-line verification.

## Scope and routes

The supplied `/flashloop-clone/blue/` homepage maps to the independent Flashloop app at `http://localhost:3002/blue`. Its root `/` renders the same homepage. Other product links retain their complete reference URLs, including queries. The root Tezu application and `apps/krea` were preserved.

## Structure

- `src/app/`: root layout, local TikTok Sans font, metadata, `/`, `/blue`, 404.
- `src/components/sites/flashloop/Sections.tsx`: server-rendered hero, model access, assistant preview, cartoon cards, studio cards, audience copy, creator CTA.
- `Composer.tsx`: creation tabs, prompt, local image/video references, model/workflow/settings controls, estimated credits, reference handoff.
- `Galleries.tsx`: release carousel, creator example lightbox, desktop scroll-driven formats, mobile format buttons, trends, FAQ.
- `Media.tsx`: video sources attach within 100px; playback pauses offscreen, on hidden documents, and with reduced motion.
- `SiteShell.tsx`: responsive navigation, keyboard handling, footer.
- `reference-layout.css`: scoped layout reconstructed from observed declarations; excludes unrelated pages and the export's Tailwind/runtime bundles.
- `flashloop.css`: interactive controls, responsive adaptations, accessibility, playback states.
- `content.json`: real reference copy, links, media mapping, FAQs.
- `public/sites/flashloop/`: local assets, including the three Tezu cartoon reference images, owned by this app.

## Optimization and cleanup

Independent dependencies and lockfile avoid changing either existing app's runtime. Root TypeScript/ESLint exclude nested applications; each app checks itself, and CI runs a matrix of all three. Root `dev:*`, `check:*`, and `check:all` commands make ownership explicit.

There are no new animation, icon, or UI-library dependencies. Static sections stay server components; interactive islands hydrate separately. TikTok Sans is self-hosted and preloaded with `next/font/local`. PNG-to-WebP conversion saved 2,090,195 bytes while preserving transparency. Videos use the supplied MP4 previews, defer loading within 100px of the viewport, and release observers/listeners on unmount. The original 88 downloaded assets totaled 56,555,580 bytes before image optimization. Repeated usage shares local URLs.

[assets.json](assets.json) maps each stored asset to its source URL. WebP paths may map to original PNG URLs because conversion occurs locally. Brand assets and reference content retain their original ownership. Generated caches and installed dependencies stay ignored.

## Verification and limits

See [VERIFICATION.md](VERIFICATION.md) for actual checks and limits. This is a frontend recreation. Reference files selected in the composer stay on this device; navigation does not upload them. Credit amounts are estimates. Linked product pages and account/generation services remain on the reference site. The footer wordmark uses typography rather than the reference's animated particle canvas; five trend tiles cycle through recorded alternate thumbnail states; Hand Drawn keeps its recorded thumbnail. These are explicit fidelity gaps, not backend features.

## GitHub Pages packaging

Set `STATIC_EXPORT=true` and `NEXT_PUBLIC_BASE_PATH=/tezu-homepage/flashloop` to export. `localPath` prefixes literal images, media, metadata and home links; CSS backgrounds use dynamic root variables for the same prefix. Next.js prefixes its own scripts and font assets. `scripts/audit-export.mjs` validates rendered HTML/CSS destinations against the exported artifact. Product subpages retain the reference site's URLs.
