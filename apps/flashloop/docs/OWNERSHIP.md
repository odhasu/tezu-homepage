# Personal project ownership and RLS

Updated: 4 November 2026. This follows [signup and verification](AUTH.md) and applies only to the independent Flashloop app and dedicated Kumi staging database. The user selected personal ownership; shared membership and ownership transfers are not supported.

## Resource and source boundaries

The Supabase plugin is the connected database tool for this work. The reviewed tenant is `kumi`, reference `txwclngedcporvrfbolu`. No other tenant is a migration or test target. Supabase CLI 3.0.0 uses explicit remote targeting for hosted operations. Keys are obtained only into process memory; no key, password, bearer token, cookie, or signed link belongs in repository notes or output.

The finished homepage, scoped CSS, assets, Tezu/Krea applications, GitHub Pages release, existing `flashloop` Vercel project, and newer deployment checkout are preserved. The deployment checkout advanced independently to `2e70b58` during this task and was not written by this work. Public frontend preview remains [GitHub Pages](https://odhasu.github.io/tezu-homepage/flashloop/blue/). Pages cannot run authenticated APIs.

This change keeps Next.js 16.4.5, strict TypeScript, Supabase PostgreSQL/Auth, and Next.js Route Handlers. It does not replace the existing frontend styles. Tailwind, R2, Vercel runtime deployment, Inngest, Sentry, PostHog, and HTTP caching remain the selected architecture; the ownership work adds private, uncached API responses without claiming the other integrations are configured. Whop and a live ChatGPT/MCP connection remain deferred.

## Database model

[The migration](../supabase/migrations/20261104202356_project_ownership.sql) creates:

| Table | Ownership and permitted user changes |
| --- | --- |
| `accounts` | One `user_id` per Auth user. Owners can read, create, delete, and update `display_name`. This is profile metadata, not the Auth identity or credit ledger. |
| `projects` | Immutable `owner_id`; owners can create, read, rename, and delete projects. |
| `jobs` | Immutable project and owner. Owners can create queued metadata, read, rename the label, and delete. Clients cannot set or update execution state. No generation is dispatched. |
| `uploads` | Immutable project and owner. Owners can reserve pending metadata, read, rename, and delete. The database generates the object key from immutable IDs. A pending row does not prove an R2 object exists or is safe. |
| `outputs` | Immutable job, project, and owner. Only an authorized worker capability can create output metadata. Owners can read, rename, and delete. |
| Existing `video_credit_accounts` | Verified-owner read access stays unchanged. Clients cannot write credits. A new trigger also prevents identity reassignment. |

Every new table enables and forces RLS. Separate SELECT, INSERT, UPDATE, and DELETE policies cover allowed operations; outputs have no client INSERT policy or privilege. Every user policy requires the current verified session and JWT subject. Child policies also require the owned parent. Composite foreign keys bind `(project_id, owner_id)`, and outputs bind `(job_id, project_id, owner_id)`, including for privileged writes. Column grants and immutable-identity triggers prevent owner reassignment, reparenting, ID changes, and forged timestamps. Metadata claims never grant access.

The account initialization trigger and backfill create blank profiles without trusting signup metadata. Existing zero-credit initialization and terminal session-denial behavior remain in place. User deletion cascades through the associated metadata.

## Route Handlers and future adapters

[The shared store](../src/lib/ownership/store.ts) checks `getUser()` and the live verified-session RPC for every operation. It derives the owner from the authenticated context, checks the parent project explicitly, adds owner/project filters, returns explicit columns, and caps lists at 100 records. RLS remains the independent database enforcement layer. Missing and foreign records return the same 404 response. Request bodies use field allowlists; clients cannot provide owners, project references, job state, object keys, or timestamps through these routes.

| Route | Methods |
| --- | --- |
| `/api/account/profile` | GET, POST, PATCH, DELETE for the current user's profile |
| `/api/projects` | GET, POST |
| `/api/projects/[projectId]` | GET, PATCH, DELETE |
| `/api/projects/[projectId]/[resource]` | GET, POST for `jobs`, `uploads`, or `outputs`; output creation returns 405 |
| `/api/projects/[projectId]/[resource]/[recordId]` | GET, PATCH, DELETE |

Mutations require the configured Origin, same-origin Fetch Metadata when present, JSON content type, and `X-Requested-With: flashloop`. JSON mutation request bodies are bounded to 12 KB. All successful and failed handled responses use `Cache-Control: private, no-store`. User data is not placed in a shared cache. Runtime handler filenames remain excluded from the GitHub Pages export.

Ownership routes instantiate only the user client; they do not create an admin client. The shared store rejects clients that were not issued by the controlled publishable-key factory, including admin clients, at runtime. A future MCP adapter must validate its bearer token and add a reviewed token-scoped path to that factory before calling `createOwnedStore`. It must never accept an owner ID as authorization, register an arbitrary client, or pass an admin client. No live MCP adapter or account connection was added.

## Privileged job boundary

The service-only `advance_owned_job` RPC verifies the exact persisted job/project/owner tuple and permits queued-to-running/cancelled or running-to-succeeded/failed/cancelled transitions. The service-only `record_owned_output` RPC locks a matching running job before inserting its output metadata. Wrong tuples and terminal-state output creation fail. Service-role table writes on the five new tables are revoked, so privileged application access uses these narrow capabilities rather than generic DML.

Public wrappers are SECURITY INVOKER. Privileged implementations live in the unexposed `private` schema with empty search paths and explicit EXECUTE grants. PUBLIC, anonymous users, and authenticated users cannot invoke worker capabilities. Existing auth service RPCs retain their separate grants and authorization checks.

No privileged worker, Inngest endpoint, or webhook Route Handler is enabled. Before connecting one, validate the provider's signature and replay rules, resolve a persisted authorized job, and pass its immutable tuple to the capability. A caller-supplied owner ID, event payload, secret header alone, or service-role key is not user authorization. Actual R2 completion and signed-download paths must check ownership and stored object keys before granting object access; database metadata tests cannot prove R2 security.

## Verification

Verification was performed against the installed Next.js route, authentication, data-security, and cookie documentation, current Supabase RLS documentation, and the CLI v3 changelog. The initial installed dependency tree was broken and generated `.next` types contained an iCloud duplicate; app dependencies were restored from the existing lockfile and only generated app cache was cleared. The first static-export copy stalled on existing iCloud placeholders and was stopped. The original public assets were hydrated with targeted `brctl download` requests, including nested Blue assets; no substitute media was introduced. The subsequent full static export passed.

Local checks completed:

- Strict TypeScript and app ESLint passed.
- 50 existing auth tests and 48 ownership handler tests passed, including the runtime rejection of admin and arbitrary clients. The handler suite uses controlled clients; it verifies application decisions and does not prove hosted RLS.
- 69 existing auth SQL assertions and 103 ownership SQL assertions passed in PGlite with the actual migrations and database roles. These are PostgreSQL behavior checks, not the hosted Auth service.
- Guarded rollback refused populated tables; empty rollback, retained credit protection, and reapplication passed.
- Node.js 24.22.2 / Next.js 16.4.5 runtime production build passed with every new runtime route.
- All 93 local assets passed the asset audit.
- The complete `npm run check` command passed under Node.js 24.22.2: lint, strict TypeScript, all 98 auth/ownership unit tests, asset audit, and runtime build.
- GitHub Pages static export passed with the existing base path, and `audit-export.mjs` verified 85 route/asset destinations. Runtime APIs and the protected account page were absent from that static route manifest. The normal runtime build was restored successfully afterward. No artifact was published.

The ownership migration was created with the CLI and applied successfully to Kumi as hosted version `20261104202356`, name `project_ownership`. Its filename was aligned to that returned hosted version without changing the applied SQL. The earlier hosted auth migration is `20261104194908`; its pre-existing local authoring filename remains `20261104193731_signup_verification.sql`.

The hosted catalog audit passed with zero violations: all six public tables have RLS; the five new ownership tables also force RLS. No public views or materialized views exist. All 23 public/private functions were reviewed for execution grants and definer behavior. Client roles cannot create objects in `public`, `private`, or `graphql_public`. The platform `graphql_public` schema has no tables/views and one SECURITY INVOKER `graphql` entry point with intentional public execution grants; its reviewed body returns an error because `pg_graphql` is not enabled. It exposes no table data. Enabling that extension requires fresh authorization verification. The audit deliberately treats application functions separately from that platform entry point.

Hosted security advisors reported no new ownership errors or warnings. Three informational notices concern the intentionally policy-free private auth tables, which deny direct access; see [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). The existing leaked-password-protection warning remains.

Real verification completed on 4 November 2026 at 21:28 Europe/Amsterdam:

- **46 hosted Data API/Auth/worker assertion groups passed.** Two disposable real Auth users and real signed JWTs exercised raw HTTPS requests to Supabase, not role impersonation or SDK database mocks. A and B could read/change only their own permitted metadata. Cross-owner SELECT/UPDATE/DELETE, forged owners, cross-owner parent inserts, same-owner reparenting, forged asset keys/state/job references, and unauthorized worker RPCs were rejected. Both pending and revoked sessions lost protected access. Positive owner CRUD and authorized worker transitions also passed.
- The actual Data API schema allowlist was confirmed as exactly `public` and `graphql_public` via the provider's 406/PGRST106 response to an invalid schema profile. The root OpenAPI request returned 401, so the script used a zero-row table request for that check. No private schema is exposed.
- **22 actual Next.js Route Handler assertion groups passed** against a locally started production server on Node.js 24.22.2, backed by the real staging database and signed fixture sessions. Cross-owner paths returned 404; forged fields returned 400; client output creation returned 405; missing sessions returned 401; pending/revoked sessions returned 403. All tested success and rejection responses were `private, no-store`. Both owners' allowed CRUD succeeded. The server was stopped afterward.
- The combined runner passed **68 assertion groups**. Both fixture identities were signed out and deleted; an independent hosted SQL check confirmed zero fixture Auth users and zero fixture projects remained.

The route integration installed session cookies programmatically and used an unused nonsecret CAPTCHA configuration placeholder; protected metadata handlers never call CAPTCHA. It proves actual handler-to-database authorization with real staging sessions, not human signup, browser cookie enforcement, delivered email, a deployed Vercel release, R2 access, webhook signatures, or production security. No secret values or server request logs were printed or persisted.

## Repeatable checks and rollback

Run from `apps/flashloop`:

```sh
npm ci
npm ci --prefix supabase/tests
npm run check
npm run test:auth:database
npm run test:ownership:database
```

For hosted checks, set `SUPABASE_CLI_BIN` to an authenticated, trusted absolute Supabase CLI path. `npm run test:ownership:staging` is locked to Kumi. The runner creates two disposable, confirmed Auth identities, obtains real signed JWTs, and uses trusted administrative finalization for their session verification. It does not send email or prove a human CAPTCHA. Credentials stay in memory; fixtures and sessions are cleaned up in `finally`.

To include actual Route Handlers, first build the runtime app with `STATIC_EXPORT` unset, then run `OWNERSHIP_TEST_ROUTES=true npm run test:ownership:staging` under Node.js 24. The runner starts an isolated loopback server, passes only explicit task configuration in its environment, suppresses server logs, and stops it in `finally`. A Pages export is not a runtime build and cannot run this test. Rebuild the runtime before rerunning the handler suite after a static-export check.

[The read-only catalog audit](../supabase/tests/ownership-audit.sql) reports RLS state, unsafe views, PUBLIC/anonymous function execution, definer search paths, client bypass roles, and unsafe table grants. Treat `audit.passed=false` as failure. Review policy/function bodies and actual Data API behavior separately. Changes to exposed schemas require extending the audit scope.

[The rollback](../supabase/rollback/20261104202356_project_ownership.sql) deliberately refuses to discard data. Stop ownership-enabled traffic first, export/archive records, and remove only explicitly authorized staging records before applying it. It does not disable RLS or remove auth/session/credit controls. The credit identity trigger is intentionally retained; reapplication is tested. The earlier auth migration has a pre-existing difference between its local authoring timestamp and hosted history version; reconcile that history deliberately before switching deployment methods, rather than blindly pushing the auth migration again.

## Remaining setup and limitations

- The new Route Handlers are not deployed to the dedicated Vercel staging alias by this change. The previous auth release remains its current runtime surface.
- Shared membership and ownership transfer require a separate schema and authorization design.
- R2 object access, actual upload validation/completion, generation, Inngest signatures/replay/idempotency, Sentry, and PostHog remain unconfigured for this ownership milestone. No provider quota or payment is consumed.
- Human CAPTCHA, delivered verification email, browser cookie behavior, and production security require their own provider-backed verification.
- The initial hosted security advisor reported leaked-password protection disabled. See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). This ownership migration does not change the Auth subscription or password configuration.

