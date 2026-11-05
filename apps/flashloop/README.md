# Flashloop blue

**[Public preview](https://odhasu.github.io/tezu-homepage/flashloop/blue/)**

Editable Next.js 16 recreation of [the supplied blue homepage](https://odhasu.github.io/flashloop-clone/blue/). Tezu and Krea remain separate applications.

```bash
npm ci
npm run dev
```

Open http://localhost:3002/blue (or `/`). `npm run check` runs lint, TypeScript, and a production build. `npm run build && npm start` serves production on the same port.

The [source repository](https://github.com/odhasu/flashloop-clone) publishes static exports; its editable source is private. This app reconstructs the homepage as React components, with local assets and scoped styles. It does not execute downloaded production JavaScript or embed the reference site.

The creation form, model/workflow/settings selectors, local reference previews, release carousel, video lightbox, scroll-driven format selector, and FAQs are implemented locally. Product navigation continues to the reference site's existing destinations. Authentication, payments, email, generation, and actual reference uploads require a service connection; no backend is supplied by the public repository.

See [project notes](docs/README.md), [research brief](../../docs/research/flashloop/brief.md), and [workspace commands](../../WORKSPACE.md).

Audit and staging records: [inventory](docs/INVENTORY.md), [frontend baseline](docs/BASELINE.md), and [isolated staging plan](docs/STAGING.md). The public GitHub Pages Blue preview and the existing Vercel `flashloop` project are separate surfaces; staging uses a new Vercel project from this app.
