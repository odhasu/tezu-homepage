# Published website apps

Use public GitHub Pages links when presenting previews to the user. Local builds remain available for command-line verification.

| App | Source in this deployment checkout | Published preview |
| --- | --- | --- |
| Tezu/Krea-derived homepage | Repository root | https://odhasu.github.io/tezu-homepage/ |
| Earlier Tezu application | `apps/tezu` | https://odhasu.github.io/tezu-homepage/tezu/ |
| Flashloop blue | `apps/flashloop` | https://odhasu.github.io/tezu-homepage/flashloop/blue/ |

The deploy workflow checks and exports each app independently, then nests the earlier app and Flashloop exports under the root artifact. Each app retains its own dependencies, assets, routes and styles. Do not replace one app's source with another.

The Flashloop authoring app lives under `apps/flashloop` in the Mac template workspace. Deployment-only workflow and notes remain in this checkout. See [current status](docs/STATUS.md) and [verification](docs/VERIFICATION.md) for release records.
