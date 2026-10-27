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
- Latest product commit: `464a75c1b9f2f45ba99490f569dc618711263480` — motion control, FAQs and signup flow.
- [Successful deployment](https://github.com/odhasu/tezu-homepage/actions/runs/40493258556)
- Desktop and mobile browser checks passed against that live version. See [verification](VERIFICATION.md).

## Current page

The homepage contains the hero and prompt, the original curved media gallery, MCP integrations, four added motion galleries, and Character Swap, in that order. The Cartoon Maker homepage section was removed at the user's request; its media and existing tool destination remain available.

Navigation now includes **Motion control** and **Pricing**, and the old Apps label is **MCP**. Log in and Start creating are larger (48px desktop, 56px in the mobile menu). Pricing uses the existing Studio pricing route through the shared app URL resolver.

The new `/motion-control/` route shows the supplied SnapInsta cartoon clip and the existing template-2 reference on a pure black background. A white draggable divider supports pointer and keyboard comparison; playback is muted and synchronized. The “450k likes” text is supplied by the user, not independently verified. New media is local, and the route supports the configured static-export base path. See [verification](VERIFICATION.md).

Both the homepage and motion-control page include five native FAQ accordions covering getting started, image references, comparison controls, current preview availability and the existing Pricing destination. They work with keyboard input and without JavaScript. No live account or generation availability is implied.

The navbar follows Resend's layout and glass styling with Tezu's knot logo, Suisse Intl typeface, labels, and destinations. Desktop menus open on hover, click, or keyboard input. Mobile navigation uses full-screen panels with a back button. The four middle galleries mix existing Tezu images and videos and support drag, buttons, keyboard controls, pause, and full-media previews.

The prompt defaults to Seedance 2.5 and 720p, with 480p and 1080p choices. The existing assistant integrations remain available. Hero Generate stays in context; explicit studio/account links use the configured Tezu application. This visual homepage does not supply an AI backend or a live MCP service.

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

Live authentication, generation and automatic job resumption belong to the subsequent backend work. No first-generation offer or trial credit allowance is implied by this frontend repair. Gallery media and order are preserved; selected showcase/template reuse remains a separate improvement. See [verification](VERIFICATION.md) for completed checks and pending UI verification.
