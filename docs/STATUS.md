# Tezu homepage status

Updated: 27 October 2026.

## Current working copy

The active homepage repository is `C:/Users/User/Downloads/Tezu-project-2026-10-26/Tezu Websites/tezu-homepage/`, on local branch `fix/creation-signup-flow`. The separate full website is the sibling `tezu-website/` repository; the older bundled application under `apps/tezu/` remains separate and unchanged by this repair.

The user requested publication to GitHub Pages and no local previews on 27 October 2026. Use [the published homepage](https://odhasu.github.io/tezu-homepage/) and [motion-control page](https://odhasu.github.io/tezu-homepage/motion-control/) for browser reviews and user-facing links. Local command-line checks remain available. The current release includes the frontend signup repair, navigation updates, motion comparison and FAQs; deployment results belong in the verification record.

Hero **Generate** now opens a native signup/login dialog after a nonempty prompt. The hero stays mounted, preserving the prompt, uploaded or selected reference, resolution and batch through close, Escape and auth-mode changes. A visible Generate label replaces the icon-only action. The dialog shows a draft summary and explicitly identifies the form as a frontend preview. Google/email controls validate inputs or show availability feedback; no account or generation job is created and no credentials are sent or stored by the application.

**Start creating** returns to the hero and focuses its prompt. Studio navigation shares one URL resolver: an optional absolute HTTP(S) `NEXT_PUBLIC_TEZU_APP_URL` set at build time, otherwise development port 3000 or the existing production bundled `/tezu/` under the homepage base path. Cross-origin draft transfer is not part of this repair.

## Last documented published version

- [Live homepage](https://odhasu.github.io/tezu-homepage/)
- [GitHub repository](https://github.com/odhasu/tezu-homepage)
- Latest product commit: `8eec3f48db9b7454e65bc50c78b9892ed40aaa9f` — Affiliate placeholder in desktop/mobile navigation with no destination, following the user's clarification.
- [Successful deployment](https://github.com/odhasu/tezu-homepage/actions/runs/40510839579)
- 21 tests, lint, strict TypeScript and production export pass. Browser automation is unavailable this turn, so this release's desktop/mobile interaction checks remain pending. Earlier browser checks apply to the versions named in [verification](VERIFICATION.md).

## Current page

The homepage contains the hero and prompt, the curved media gallery, MCP integrations, four added motion galleries, a larger Motion control comparison, and Character Swap, in that order. The Cartoon Maker homepage section was removed at the user's request; its media and existing tool destination remain available.

The curved gallery mixes six muted looping videos and five photos/poster stills. Its three footer buttons and “A few ideas. Endless possibilities.” caption were removed at the user's request. Drag and Left/Right browsing remain; Space pauses motion/playback and Enter opens the original video or photo. Sources are attached only when a video is eligible and onscreen. Motion control leads the showcase area with a 640px comparison and the existing white divider; the standalone route remains available. See verification for the deployment result and pending browser review.

Navigation includes **Motion control**, **Pricing** and an **Affiliate** placeholder, and the old Apps label is **MCP**. The user's clarification requires Affiliate to open no link: it is a disabled button in the desktop/mobile menus, with no URL or page. Keyboard browsing skips it. Log in and Start creating are larger (48px desktop, 56px in the mobile menu). Pricing uses the existing Studio pricing route through the shared app URL resolver.

The new `/motion-control/` route shows the supplied SnapInsta cartoon clip and the existing template-2 reference on a pure black background. A white draggable divider supports pointer and keyboard comparison; playback is muted and synchronized. The “450k likes” text is supplied by the user, not independently verified. New media is local, and the route supports the configured static-export base path. See [verification](VERIFICATION.md).

Both the homepage and motion-control page include five native FAQ accordions covering getting started, image references, comparison controls, current preview availability and the existing Pricing destination. They work with keyboard input and without JavaScript. No live account or generation availability is implied.

The performance pass preserves the design while using 640px-bounded WebP display posters and a 90px logo. Original artwork/reference files remain available for dialogs and selection. Hero and curved-carousel animation loops sleep when idle/offscreen, dimensions are cached, the WebGL engine loads near the galleries, and video autoplay does not retry every frame after rejection. `TezuHero.tsx` owns hero form state; asset URL resolution and media catalog data live in separate modules. See the performance record in [verification](VERIFICATION.md).

The navbar follows Resend's layout and glass styling with Tezu's knot logo, Suisse Intl typeface, labels, and destinations. Desktop menus open on hover, click, or keyboard input. Mobile navigation uses full-screen panels with a back button. The four middle galleries mix existing Tezu images and videos and support drag, buttons, keyboard controls, pause, and full-media previews.

The prompt defaults to Seedance 2.5 and 720p, with 480p and 1080p choices. MCP choices are ChatGPT, Claude App and Other; Claude Code was removed at the user's request. Other shares the black card, Suisse typography and compact actions used by the assistant panels. The MCP menu can select Other from either public page. Hero Generate stays in context; explicit studio/account links use the configured Tezu application. This visual homepage does not supply an AI backend or a live MCP service.

## Historical authoring and published route map

The following Mac authoring/deployment locations describe the earlier setup, not the current Windows working copy above. Published fallback routes are retained.

| Purpose | Authoring workspace | Published repository / URL |
| --- | --- | --- |
| Main homepage | `apps/krea/` | Repository root; `/tezu-homepage/` |
| Earlier Tezu application | Workspace root | `apps/tezu/`; `/tezu-homepage/tezu/` |
| Cartoon Maker destination | Earlier application `/#mcp` | `/tezu-homepage/tezu/#mcp` |
| Character Swap destination | Earlier application `/templates/` | `/tezu-homepage/tezu/templates/` |

Local workspace: `/Users/oscargraafmans/Desktop/ai-website-cloner-template`.
Deployment checkout: `/Users/oscargraafmans/.codex/deployments/tezu-homepage`, branch `main`.

The earlier deployment checkout was used for Git operations. The original Mac workspace previously reported `fatal: bad object HEAD`; its recovery state is not established here. Some older Desktop files may be iCloud placeholders. Preserve existing content and verify reads before replacing files.

Earlier homepage releases synchronized files between `apps/krea` and the deployment checkout. Current work edits the Windows homepage repository directly; do not copy files between the two current repositories or change the bundled application as part of this repair.

## Open work

Live authentication, generation and automatic job resumption belong to the subsequent backend work. No first-generation offer or trial credit allowance is implied by this frontend repair. Gallery media and order are preserved; selected showcase/template reuse remains a separate improvement. See [verification](VERIFICATION.md) for completed source, deployment and desktop/mobile checks.
