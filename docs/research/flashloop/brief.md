# Flashloop blue reference brief

Reference inspected: https://odhasu.github.io/flashloop-clone/blue/
Repository: https://github.com/odhasu/flashloop-clone
Date: 3 November 2026.

The repository README confirms that only static frontend exports are public; editable source/history remain private. Reconstruct semantic React components from observed content, SVG shapes, layout declarations, and assets. Do not ship downloaded Next.js runtime bundles, HTML iframes, or source-site scripts.

## Page order

1. Sticky navigation: Flashloop wordmark, Explore, Image, Video, MCP, Creator Program, Pricing promotion, account links; mobile menu.
2. Hero: blue perspective grid and moving light streaks, eight transparent voxel clouds, uppercase headline, video/image composer, manual creation link, 4.7 rating.
3. Latest arrivals: Faceless Studio, Mirage Studio, Kling 4.0, Film Studio, Ads Studio.
4. Three cartoon story cards from the Tezu studio.
5. Global model access with vertical provider/model marquee.
6. ChatGPT assistant integration panel.
7. Flashloop Studio promo and six tool cards.
8. Two continuous media rails with creator examples and preview controls.
9. Marketing Teams / Agencies / Creators audience cards.
10. Sticky desktop formats sequence; scroll chooses format and media row; click is also available. Mobile/reduced motion use direct selection.
11. Six trend tiles, FAQ accordion, creator program banner.
12. Blue multi-column footer and legal row.

## Layout and motion

TikTok Sans; charcoal `#111315` page; white headings; blue controls and lighter `#a9ccff` accent text. The observed published CSS currently uses `#0065fc` even though the repository README describes an older `#3344d6` palette. Follow the rendered page.

Desktop content max-width starts at 1440px. At 1024px and above a bounded `--home-unit` scales between 1px and 1.33333px as the viewport grows to 2280px; the composer starts at 768px maximum. Reference heading transitions include 430/640/1024 widths. Use responsive CSS rather than scaling an entire screenshot.

Hero light drifts and grid signals run over time; cloud drift uses per-instance timing/position/brightness. Model/creator rails loop with hover/focus pause. Desktop format activation is scroll-driven through a sticky section; it must retain a real scroll distance and allow reverse scrolling. Videos use local MP4s; no HLS playback dependency is necessary for the supplied previews.

## Ownership and destinations

Local app: `apps/flashloop`; component/assets/docs belong there. Scope is the supplied blue homepage. Product pages, legal pages, account actions and model details retain full source URLs; they are not silently replaced by placeholder local routes.

Actual asset provenance and implementation decisions: [app notes](../../../apps/flashloop/docs/README.md). Workspace map: [WORKSPACE.md](../../../WORKSPACE.md).
