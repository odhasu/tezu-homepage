# Shared credits and spend caps

Current extension: [JOBS.md](JOBS.md) records the 5 November durable Inngest outbox, execution concurrency recheck, provider bindings, and atomic callback settlement. The historical verification/configuration record below remains valid for that milestone; provider adapters and hosted job setup are still disabled/unresolved.

Updated: 4 November 2026. This milestone changes the independent Flashloop backend only. The finished frontend, root Tezu/Krea applications, published Pages release, and newer deployment checkout were preserved. Whop payments and a live ChatGPT/MCP connection remain deferred.

## Shared authorization boundary

`src/lib/entitlements/service.ts` is the server-only, uncached entry point for website submissions and background workers. `POST /api/generations` uses the existing edge-origin and same-origin checks, a bounded JSON body, a factory-issued user client, and fresh `requireProtectedSession` authorization. The database independently binds the request to the JWT subject and current verified session. A null subject, another user's project, revoked session, or missing account entitlement is denied.

Background submission through `reserveForWorker` requires the original live verified session as well as the owner and project. The database uses the actual PostgreSQL service role, not a user-editable JWT metadata claim, to authorize worker transitions. A job already authorized at reservation may continue after that browser logs out; claim still checks the current account entitlement, email/banned state, and kill switch. Revoking the account entitlement stops future claims. A future MCP adapter must authenticate its bearer token and map it to a user-scoped client/session before using this same service. No MCP transport or worker webhook is enabled here. A service key, owner ID in an event, or UI state alone is insufficient user authorization.

The request accepts `projectId`, `requestKey`, `priceKey`, `prompt`, and optional `label`. Users cannot submit credits, provider costs, or billable model options. Trusted pricing configuration selects a fixed provider profile, including model, quantity, duration, resolution, and other billable options. Its configured credits, worst-case cost, and profile are snapshotted at reservation; a later price update cannot change that request. The SQL function computes the fingerprint from the actual request fields. Worker dispatch uses the stored prompt/profile, never a replayed event's replacement parameters. No real provider adapter or price is installed.

## Atomic accounting and dispatch

The CLI-created migration is `supabase/migrations/20261104210635_generation_entitlements.sql`. It leaves generation disabled, prices absent, and account entitlements disabled. New accounts retain the existing **zero automatic video credits** rule. Monetary values use integer millionths of the configured currency; currency and business prices remain unselected.

A PostgreSQL transaction locks the singleton policy row, account balance, daily counters, and active-job count. It validates ownership, entitlement, funded credits, account/global daily spend ceilings, and active-job limits before creating the project job, durable request, and credit/cost reservation together. The singleton lock intentionally favors straightforward correctness over maximum throughput. Every channel shares it. The unique `(user_id, request_key)` constraint and database fingerprint return the original reservation on identical replay and reject changed requests. Failed quota checks leave no job or debit.

Daily limits count today's committed cost plus **all in-flight reservations**, including unknown outcomes from earlier days. Committing a final result atomically removes its hold and books actual cost to the settlement day in the configured timezone. Currency/timezone changes are rejected once ledger entries exist; changing financial units or period boundaries requires a deliberate migration.

Before any provider call, a worker obtains `claim_generation`. Exactly one invocation changes `reserved` to `dispatching` and receives `dispatchAllowed=true`, the stored provider input, and a deterministic provider idempotency key. All retries return `dispatchAllowed=false`. `dispatchReserved` calls an adapter only after that transaction succeeds. A lost claim response causes no provider call. A crash after claim or an ambiguous provider timeout retains the claim, credits, cost, and active slot. It never automatically retries provider submission, expires the claim, or refunds it. Future adapters must enforce the quoted provider bound and use the supplied idempotency key where supported.

`release_generation` can refund only an **unclaimed** reservation, using the same lock as dispatch. Once claimed, even a provider timeout cannot release it. A signature-verified worker must obtain an authoritative final provider result and pass actual cost plus `succeeded`, `failed`, or `cancelled` to `resolve_generation`. Known final results release unused monetary hold and the active slot; generation credits stay consumed. Post-dispatch credit refunds await an explicit business policy and do not happen automatically. A zero-cost confirmed failure can settle at zero without pretending that a timeout proves no charge.

If actual provider cost exceeds the quoted bound, the database immediately counts the full known exposure and disables generation. It retains the active reservation as `reconciliation_required`. An operator must investigate the pricing/adapter defect and reconcile the exact recorded result before enabling generation again. Reconciliation records already-incurred cost even if the provider violated a cap; it cannot erase a real charge to make a budget appear satisfied. Replayed finalization cannot charge twice or change the recorded result.

Financial rows and linked jobs use restrictive foreign keys. Deleting an Auth identity, project, or generation job cannot erase an outstanding request or its accounting. Legacy metadata-job worker transitions cannot bypass the entitlement state machine for generation-linked jobs. Anonymization, ledger retention, and account deletion require a separate financial-data lifecycle design.

Every entitlement success/error response is `private, no-store`. HTTP caching, UI estimates, and previous auth responses never determine balances or authorize spending.

## Configuration and missing setup

Only service-role RPCs may configure policy, account entitlements, and provider pricing. There is no browser/admin configuration screen or payment grant endpoint. Operator order:

1. Apply the migration to the intended staging tenant after reviewing existing migration history. No hosted entitlement migration was applied in this task.
2. Choose currency, global/account daily caps, reset timezone, active-job limits, provider pricing/bounds, credit conversion, and post-dispatch refund policy. `configure_generation_policy` records explicit policy values; no production numbers are guessed.
3. Enable approved accounts with `configure_generation_account`. Optional account-specific caps/job limits can only tighten global defaults. Credits remain zero until deliberately funded by a trusted operation; Whop grants remain deferred.
4. Configure versioned price keys with `upsert_generation_price`, including the exact bounded provider profile. Implement and verify the provider adapter, reconciliation evidence, signed Inngest events, and replay handling before connecting dispatch.
5. Complete hosted Data API/Auth/Route Handler checks, provider-backed timeout/billing checks, and deployment verification before enabling generation with `set_generation_enabled`. Set it to false to stop new reservations and dispatch claims immediately; retain all existing reconciliation data.

R2 access, actual provider execution, Inngest transport, Sentry, and PostHog remain unconfigured for this milestone. Those existing stack choices are retained; no replacement services were introduced. No provider was called, no payment or live MCP connection was enabled, and no Pages/Vercel release was published.

## Actual verification

Run from `apps/flashloop` after installing app dependencies and `npm ci --prefix supabase/tests`:

```sh
npm run check
npm run test:auth:database
npm run test:ownership:database
npm run test:entitlements:database
npm run test:entitlements:concurrency
```

The concurrency command starts a disposable native PostgreSQL 17.11 server, bound to loopback with private temporary data/socket directories, using pinned test-only `embedded-postgres` and `pg` dependencies. It uses independent connections and cleans up its server/data in `finally`. It does not read hosted credentials. Run as a normal non-root local user on a supported native platform.

Executed results are recorded in [VERIFICATION.md](VERIFICATION.md). Service/Route Handler tests use controlled clients and provider failures; they verify application decisions, not provider security. PGlite exercises real SQL, constraints, roles, and grants against a modeled Auth schema. Native PostgreSQL races verify real concurrent locking and transactions across website/worker RPCs. Neither fixture proves hosted Supabase Auth, Inngest signatures, R2 access, actual AI provider idempotency/pricing, or production security. No such claim is made.
