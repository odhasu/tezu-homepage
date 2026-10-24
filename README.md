# Tezu Homepage

An animated Next.js homepage with native-format Tezu images and videos, Cartoon Maker and Character Swap previews, an MCP-style ChatGPT banner, and Claude App, Claude Code, and Other tabs.

Live website: https://odhasu.github.io/tezu-homepage/

## Local development

```sh
npm ci
npm run dev
```

Open http://localhost:3001/. Run `npm run check` for lint, TypeScript, and a production build.

## Deployment

Pushes to `main` deploy automatically to GitHub Pages. See [GITHUB_PAGES.md](GITHUB_PAGES.md) for static build instructions.

Generation links open the Tezu studio. Assistant connection buttons show the existing availability guide; this repository does not provide a Tezu generation backend or MCP server.

The layout is based on the Krea homepage and uses locally saved source media from Krea and Tezu. Media retains its original formats and proportions.
