# Tezu homepage status

Updated: 26 October 2026.

## Published version

- [Live homepage](https://odhasu.github.io/tezu-homepage/)
- [GitHub repository](https://github.com/odhasu/tezu-homepage)
- Latest product commit: `5ff13fa` — Resend-style Tezu navigation.
- [Successful deployment](https://github.com/odhasu/tezu-homepage/actions/runs/40329779223)
- Desktop and mobile browser checks passed against that live version. See [verification](VERIFICATION.md).

## Current page

The homepage contains the hero and prompt, the original curved media gallery, app integrations, four added motion galleries, Cartoon Maker, and Character Swap, in that order.

The navbar follows Resend's layout and glass styling with Tezu's knot logo, Suisse Intl typeface, labels, and destinations. Desktop menus open on hover, click, or keyboard input. Mobile navigation uses full-screen panels with a back button. The four middle galleries mix existing Tezu images and videos and support drag, buttons, keyboard controls, pause, and full-media previews.

The prompt defaults to Seedance 2.5 and 720p, with 480p and 1080p choices. The existing assistant integrations remain available. Generation and account links open the separate Tezu application; this visual homepage does not supply an AI backend or a live MCP service.

## Routes and working copies

| Purpose | Authoring workspace | Published repository / URL |
| --- | --- | --- |
| Main homepage | `apps/krea/` | Repository root; `/tezu-homepage/` |
| Earlier Tezu application | Workspace root | `apps/tezu/`; `/tezu-homepage/tezu/` |
| Cartoon Maker destination | Earlier application `/#mcp` | `/tezu-homepage/tezu/#mcp` |
| Character Swap destination | Earlier application `/templates/` | `/tezu-homepage/tezu/templates/` |

Local workspace: `/Users/oscargraafmans/Desktop/ai-website-cloner-template`.
Deployment checkout: `/Users/oscargraafmans/.codex/deployments/tezu-homepage`, branch `main`.

Use the deployment checkout for reliable Git operations. The original workspace previously reported `fatal: bad object HEAD`; its Git recovery has not been performed. Some Desktop files may be iCloud placeholders. Preserve existing content and verify reads before replacing files.

For homepage changes, synchronize only the files changed in this task between `apps/krea` and the deployment root. Keep the earlier Tezu application separate. Read current repository instructions before editing.

## Open work

No outstanding product request from this chat after the navbar release. Persistent Markdown notes have been added in response to the documentation request. Record future work here when requested, and distinguish pending work from optional ideas.
