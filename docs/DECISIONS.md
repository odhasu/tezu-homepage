# Current Tezu decisions

Updated: 26 October 2026. These notes describe the implemented direction. Source measurements and details remain in the linked research briefs.

| Decision | Reason and reference |
| --- | --- |
| Preserve the Tezu knot logo, dark palette, and Suisse Intl fonts | Maintain Tezu's identity while adapting external layout references. |
| Keep the hero prompt immediately available | Current project instructions supersede historical welcome/zoom experiments. Heading and empty-prompt text use the Aura-inspired reveals; typing stops example rotation. See [homepage motion](research/tezu-homepage-motion/brief.md). |
| Adapt Resend navigation inside the existing header | Reuse working Tezu destinations and keyboard behavior. The `resend` appearance adds centered links, textured glass, compact dropdowns, and mobile drill-down panels; the default Arc appearance remains available. See [navbar research](research/resend-navbar/brief.md). |
| Preserve existing homepage sections while inserting galleries in the middle | The user requested all four references with random images and videos. Their section sits between integrations and the tool showcases. See [gallery research](research/tezu-motion-galleries/brief.md). |
| Reconstruct public motion references in editable code | Lens, reel, fold, and arc effects are original implementations based on public demonstrations. No paywalled source or downloaded production bundles are embedded. |
| Retain original media formats and preview proportions | Source media stays local. Opened previews use source dimensions and `object-fit: contain`; gallery motion may deform thumbnails. |
| Provide alternatives to drag and respect reduced motion | Galleries include buttons, keyboard navigation, pause, and previews. Reduced motion disables autoplay. Mobile vertical scrolling remains available. |
| Link Cartoon Maker to the included Tezu application | The user clarified that the destination is the local/published Tezu app, not the real `tezu.ai` website. Published destination: `/tezu-homepage/tezu/#mcp`. |
| Keep preview work separate from generation, auth, and payments | Existing UI and destinations are preserved; visual changes do not imply new backend capability. |
| Persist context in Markdown and read it before continuing | Explicit user preference on 26 October 2026. Use [the documentation index](README.md), keep status and checks current, and link to evidence rather than duplicating it. |

If a later request changes one of these choices, update this file and the affected brief. Do not treat older screenshots or research as instructions to restore superseded behavior.
