# Tezu Homepage

An animated Next.js homepage with native-format Tezu images and videos, Cartoon Maker and Character Swap previews, an MCP-style ChatGPT banner, and Claude App, Claude Code, and Other tabs.

Live website: https://odhasu.github.io/tezu-homepage/

Motion control: https://odhasu.github.io/tezu-homepage/motion-control/

Both pages include FAQs. Use the published GitHub Pages site for browser previews; local commands below are for development checks.

## Local development

```sh
npm ci
npm exec -- next dev --hostname 127.0.0.1 --port 3101
```

Open http://127.0.0.1:3101/. The separate `tezu-website` studio uses port 3000. Use Node.js 24 or newer. Run `npm test` for focused form/destination regression tests and `npm run check` for lint, TypeScript, and a production build.

## Deployment

Pushes to `main` deploy automatically to GitHub Pages. See [GITHUB_PAGES.md](GITHUB_PAGES.md) for static build instructions.

Hero **Generate** opens an in-context signup/login preview. The prompt, reference, resolution and batch stay on the homepage through dismissal and mode changes. Accounts, Google sign-in and generation are not connected; the form does not submit or store credentials.

Studio navigation uses `NEXT_PUBLIC_TEZU_APP_URL` when configured with an absolute HTTP(S) URL. Otherwise development links use `http://127.0.0.1:3000/` and production keeps the bundled `/tezu/` destination under `NEXT_PUBLIC_BASE_PATH`. Public environment variables are set when building. **Start creating** returns to and focuses the homepage composer.

Assistant connection buttons show the existing availability guide; this repository does not provide a Tezu generation backend or MCP server.

The layout is based on the Krea homepage and uses locally saved source media from Krea and Tezu. Media retains its original formats and proportions.

## Project notes

Read [the documentation index](docs/README.md) for current status, decisions, verification, and source research. Keep these Markdown notes updated when continuing the project.
