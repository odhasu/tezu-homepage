# Durable generation jobs and provider callbacks

Updated: 5 November 2026. This milestone extends the independent Flashloop backend after [spend reservations](SPEND_CAPS.md) and [private storage](STORAGE.md). The finished frontend, other applications, published GitHub Pages release, and newer deployment checkout are preserved. No hosted migration, deployment, paid provider operation, Whop integration, or live ChatGPT/MCP connection was performed.

## Implemented boundary

The existing Next.js 16.4.5 TypeScript Route Handlers, Supabase PostgreSQL/Auth, Cloudflare R2 storage boundary, Vercel runtime target, and Inngest 4.26.2 are retained. Tailwind/frontend files are unchanged. Sentry and PostHog remain selected but unconfigured. Sensitive API and workflow responses use `Cache-Control: private, no-store`; HTTP caches never authorize ownership or spending.

`POST /api/generations` continues to use the shared live-session authorization and reservation service. It accepts only the validated project, request key, price key, prompt, and optional label. PostgreSQL verifies the owner/session and snapshots the trusted provider profile and quote. A new trigger inserts an outbox record in the same reservation transaction. There is no window where a successful reservation loses its dispatch obligation before enqueueing.

The minute-based Inngest outbox function reads up to 50 persisted identifiers. It sends `flashloop/generation.requested` with only `requestId`, then records delivery. It never puts prompts, provider profiles, callback bodies, credentials, or signed URLs into durable step results. Events use deterministic request/type/five-minute-bucket IDs. Due reserved, dispatching, unknown, and dispatched jobs are redelivered after five minutes, oldest delivery first. This recovers exhausted execution retries and missed callbacks. Inngest's 24-hour event deduplication is an optimization; permanent database claims and receipts provide correctness beyond that window.

The execution function accepts exactly `{ requestId }`. It loads owner, project, job, request key, provider identity, and status from PostgreSQL; event-supplied ownership, costs, and replacement prompts are rejected. Inngest bounds active execution to one step globally and one per request. The database independently checks live account/global policy, reserved exposure, entitlement, kill switch, and account active-job limits before granting the single dispatch claim. Tightening an account/global active-job limit while jobs wait is checked again at execution. Existing reservations already occupy slots; a tightened cap can leave them held until policy changes or an operator releases an unclaimed reservation.

## Paid operation and restart rules

Only the original successful `claim_generation` invocation may call the provider. The call uses the stored prompt/profile and deterministic reservation idempotency key. A restart, event replay, lost claim response, timeout, or failed provider-ID persistence cannot obtain another dispatch permission. The provider-job update atomically inserts a unique `(provider, provider_job_id)` binding to the original reservation. Neither another project nor another reservation can reuse that binding.

After a claim, a failed or ambiguous provider response retains credits, spend exposure, and the active slot. No timeout, absent lookup result, expired provider idempotency window, or workflow failure automatically refunds or resubmits. This deliberately favors preventing duplicate charges over automatically completing uncertain work. A crash after claiming but before sending can therefore leave a held job that requires reconciliation.

`GenerationAdapter.reconcile` must perform an authoritative, uncharged provider read. It may recover an accepted provider job ID and an optional normalized final outcome/cost. The worker checks that both accepted-job and callback evidence identify this exact persisted request. It first persists a recovered binding, then applies authoritative final evidence through the same atomic settlement RPC as callbacks. Reconciliation uses a separate deterministic receipt namespace and canonical evidence digest. A missing job or transport failure never proves no charge and never grants another send. Providers without authoritative lookup or callback redelivery require manual reconciliation and must not be enabled without an agreed recovery procedure.

## Callback contract

`POST /api/webhooks/generation/[provider]` retains the Cloudflare origin guard and has an independent `GENERATION_WEBHOOKS_ENABLED` switch. Keep callback settlement available when stopping new dispatch; the database kill switch stops reservations/claims without discarding existing obligations. The Inngest endpoint remains signature protected in Cloud mode and can register storage cleanup, generation functions, or both under its existing app identity.

Callback bodies are streamed with a 64 KiB bound. The selected server-owned adapter receives the exact raw bytes, headers, and current time. It must authenticate the provider's documented signature, signed timestamp, tolerance, rotation rules, and replay semantics before any callback RPC runs. No universal HMAC scheme or guessed provider guarantee is installed. The shared layer checks the verified result shape, including event ID, provider job ID, terminal outcome, and exact safe-integer cost. Providers must supply authoritative final costs in the configured currency; estimates and unverified callback claims cannot settle credits.

`apply_generation_callback` is service-only. PostgreSQL resolves the persisted provider binding rather than accepting an owner/project in the body. Under the same financial mutex, it checks the permanent `(provider, event_id)` receipt, applies the job/ledger transition, and inserts the receipt in one transaction. Unknown jobs fail without an inbox insert or financial mutation. Identical duplicate events return a duplicate result. A reused event ID with changed raw-body digest, job, outcome, or cost conflicts. Distinct late progress or conflicting terminal events are retained without reopening or resettling the job. The first authoritative terminal result wins. Provider activation requires a documented immutable-final-result contract; later provider billing corrections need explicit operator reconciliation policy.

Known cost overruns retain the existing reservation behavior: count the full exposure, mark reconciliation required, and disable new generation. No automatic post-dispatch credit refund is introduced. Signature bodies, headers, secrets, and raw provider diagnostics are not stored in callback receipts or workflow output.

## Disabled providers and storage limits

The production adapter registry is intentionally empty and `generationAdaptersReady()` is false. Enabling flags or adding Inngest keys alone cannot activate generation. Unknown providers fail closed before a service client is created. Fixture adapters exist only in tests; their signatures, prices, and behavior are not production guarantees.

Private R2 remains disabled and was not accessed in this milestone. The existing generation API accepts text only; it does not accept uploaded references or provider-selected output URLs. Future input adapters must call `requireReadyInputs` before a paid dispatch. Future output ingestion must use persisted job ownership, approved provider download destinations, verified bytes, and the existing private-object quota/sealing service. Only bounded single-frame PNG/JPEG/WebP ingestion currently exists. Video generation scheduling is supported by the job contract, but private video ingestion/decoding and cancellation are not enabled. Do not treat a successful provider callback as proof that an output object is valid or stored.

## Required setup before activation

1. Review the intended staging tenant and migration history. Apply `20261105124533_durable_generation_jobs.sql` after the existing five migrations. It adds private outbox/binding/receipt tables with forced RLS, service-only invoker wrappers, and narrowly granted private implementations. It does not enable generation or fund accounts. Existing active reservations are backfilled without changing ownership or holds.
2. Select image/video providers and obtain current API contracts: exact bounded models/options and prices, idempotency-key support and lifetime, job lookup, callback signing/timestamp/replay rules, terminal-cost semantics, provider retries, and cancellation/charge behavior. Implement reviewed adapters using bounded server-only outbound transport. Never retry a billable request based only on an HTTP timeout or 429/5xx label.
3. Provision the intended Inngest environment, event key, signing key/rotation, owned HTTPS endpoint, and Cloudflare ingress. Install secrets only in the selected Vercel secret store. Keep Cloud mode and the edge guard; do not use unsigned development mode on a public endpoint. The existing Inngest app ID remains `flashloop-private-storage` to preserve cleanup schedules.
4. Complete existing Auth, pricing/currency, credit funding, account/global caps, R2 activation/privacy, and storage prerequisites. Configure Sentry/PostHog with data-minimization rules before claiming operational monitoring. Prompts, secrets, raw callbacks, signed URLs, and financial payloads must not become analytics properties.
5. Run hosted acceptance with disposable accounts and the real selected providers: duplicate/out-of-order callbacks, forged/expired/future signatures, unknown/foreign jobs, restarts before/after submission, lost DB/provider responses, lookup recovery, revoked entitlements, concurrent execution, exact billing reconciliation, and any documented cancellation/refund behavior. Record evidence and operator procedures before enabling either production adapter or generation policy.

Whop checkout stays disabled. No payment grants, payment callbacks, or live ChatGPT/MCP transport are included. Cancellation remains unresolved; no UI or API promises provider cancellation or post-dispatch refunds.

## Verification and limits

The installed Next.js Route Handler, data-security, backend-for-frontend, and static-export guides were read before code changes. Current Supabase changelog/functions guidance and Inngest idempotency guidance were consulted. Supabase documentation plugin access closed its transport; Inngest environment discovery returned an unavailable-tool error. No cloud environment, provider credentials, or hosted migration was changed through those plugins.

Executed results and runtime/static-export checks are recorded in [VERIFICATION.md](VERIFICATION.md#durable-generation-jobs--5-november-2026). Tests use synthetic Auth rows and fixture provider adapters except where explicitly marked as installed SDK or actual HTTP checks. Local SQL/locking, mock signatures, and disabled HTTP gates do not prove hosted provider behavior, deployed configuration, or production security.

Run from this app with Node.js 24:

```sh
npm run check
npm run test:jobs:database
npm run test:jobs:concurrency
npm run test:jobs:runtime
```

The native PostgreSQL runner starts its own loopback PostgreSQL 17.11 instance in a private temporary directory, uses independent connections, reads no hosted credentials, and removes its cluster afterward. Database/worker tests cover permanently deduplicated charges and settlements; actual provider idempotency and callback security remain activation gates.

[The guarded rollback](../supabase/rollback/20261105124533_durable_generation_jobs.sql) refuses enabled generation, retained dispatch records, provider bindings, callback receipts, or outstanding financial obligations. It is tested only for safe refusal and an empty rollback/reapplication. Stop traffic and workers first; populated deployments need a reviewed forward recovery plan rather than deleting financial or replay evidence.
