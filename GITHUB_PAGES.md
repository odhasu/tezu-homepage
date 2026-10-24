# GitHub Pages

The standalone homepage is published from the `odhasu/tezu-homepage` repository.

- Website: https://odhasu.github.io/tezu-homepage/
- Repository: https://github.com/odhasu/tezu-homepage

The deployment workflow runs lint, TypeScript, and a static Next.js build before publishing. Pushes to `main` deploy automatically.

For a local static build, run:

```sh
NEXT_PUBLIC_BASE_PATH=/tezu-homepage STATIC_EXPORT=true npm run check
```

The output is in `out/`. Normal `npm run dev` and `npm start` continue to serve the site at `/` without these environment variables.
