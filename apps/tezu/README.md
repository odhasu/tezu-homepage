# Tezu main page

The editable Tezu app previously served at `http://127.0.0.1:3000/` lives here. The original components, responsive styles, scroll animations, and local media are preserved.

GitHub Pages publishes this app at `/tezu-homepage/tezu/`. The homepage's Cartoon Maker card opens `/tezu-homepage/tezu/#mcp`, the “How to create cartoon animations” walkthrough.

Run locally:

```sh
npm ci
npm run dev -- --port 3000
```

Build for GitHub Pages:

```sh
NEXT_PUBLIC_BASE_PATH=/tezu-homepage/tezu NEXT_PUBLIC_SITE_URL=https://odhasu.github.io/tezu-homepage/tezu/ npm run check
```

The deployment workflow builds both apps and copies this app's static output into the main site's `out/tezu/` folder. Query-dependent studio and account screens read their parameters in the browser so they work on static hosting.

This preserves the existing preview functionality: generation and account sign-in are not connected to a backend.
