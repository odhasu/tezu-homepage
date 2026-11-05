# Billing database contract

Implementation in progress, 5 November 2026. Only the independent Flashloop app is in scope. No hosted migration or provider-backed billing acceptance is implied.

All billing RPCs are service-role-only. Browser adapters must freshly verify the Supabase session and preserve edge/same-origin protection. SQL independently checks the persisted verified session for identity linking, checkout and account reads. No email or editable metadata establishes payment ownership. Every financial mutation locks `private.generation_policy` first; provider network calls must happen outside database transactions.

## RPCs

- `configure_billing_policy(p_environment text,p_company_id text,p_enabled boolean)` selects `sandbox` or `production`; initially unconfigured and disabled. Company ID means the SDK merchant/account ID.
- `configure_billing_plan(p_environment text,p_plan_key text,p_plan_id text,p_product_id text,p_credits bigint,p_currency text,p_amount_minor bigint,p_active boolean)` configures monthly individual plans explicitly. Plan ID means the SDK variant ID. No commercial values or merchant IDs are seeded.
- `billing_begin_link(p_user_id uuid,p_session_id uuid,p_state_hash text)` stores a SHA-256 OAuth state hash with a ten-minute expiry. `billing_consume_link` takes the same arguments and consumes it exactly once. `billing_bind_identity(p_user_id uuid,p_session_id uuid,p_whop_user_id text)` requires a consumed unused state for that live session and permanently binds the verified provider user ID. Existing identical bindings may be read again; reassignment conflicts. Store neither tokens nor PKCE verifier here.
- `billing_begin_checkout(p_user_id uuid,p_session_id uuid,p_plan_key text,p_request_key text)` returns `{intentId,createAllowed,status,providerCheckoutId,whopUserId,plan}`. Plan is `{planKey,planId,productId,credits,currency,amountMinor}`. Only the original invocation returns `createAllowed:true`. The permanent claim remains after a lost response or provider timeout.
- `billing_finish_checkout(p_intent_id uuid,p_provider_checkout_id text)` records one immutable provider checkout configuration ID; `billing_unknown_checkout(p_intent_id uuid)` records ambiguous submission. Both return the intent DTO. Neither creates payments or retries provider creation.
- `billing_receive_webhook(p_environment text,p_event_id text,p_event_type text,p_resource_id text,p_payload_hash text)` accepts only after SDK signature verification and returns `{receiptId,disposition,duplicate}`. Persist minimal IDs/type/SHA-256, never raw payload/signature. A reused event ID with different contents conflicts.
- `billing_due_receipts(p_limit integer)` returns minimal due receipt DTOs. `billing_defer_receipt(p_receipt_id uuid)` schedules a bounded retry after authoritative retrieval failure. No raw provider error is persisted.
- `billing_apply_snapshot(p_receipt_id uuid,p_snapshot jsonb)` applies the authoritative normalized snapshot below and returns `{receiptId,disposition,grantedCredits}`. Receipt disposition, membership, paid grant, credit bucket and balance mutation commit in one transaction. Duplicate payment IDs and duplicate membership periods cannot mint again.
- `billing_account(p_user_id uuid,p_session_id uuid)` expires unused paid credits and returns `{linked,environment,whopUserId,billingEnabled,billingAccess,reviewRequired,videoCredits,subscription,plans}`. Subscription is null or `{membershipId,planKey,status,periodEnd,cancelAtPeriodEnd}`. Plans use the plan DTO above. Treat all responses as private/no-store.

## Normalized authoritative snapshot

```ts
type Snapshot = {
  environment: "sandbox" | "production";
  companyId: string;
  resourceId: string; // exact verified receipt resource
  whopUserId: string;
  observedAt: string; // ISO timestamp immediately before authoritative retrieval
  membership: {
    id: string;
    planId: string;
    productId: string;
    status: string;
    valid: boolean;
    createdAt: string;
    periodStart: string;
    periodEnd: string;
    cancelAtPeriodEnd: boolean;
    checkoutId: string | null; // retrieved payment checkout configuration; never metadata alone
  };
  payment: null | {
    id: string;
    membershipId: string;
    planId: string;
    checkoutId: string;
    status: string;
    paid: boolean;
    refunded: boolean;
    disputed: boolean;
    billingReason: string;
    amountMinor: number; // exact subtotal converted without floating-point rounding
    currency: string;
    createdAt: string;
    paidAt: string | null;
    periodProven: boolean;
  };
};
```

Provider adapter owns SDK signature/API parsing and consistency checks; SQL validates bounded normalized fields, trusted environment/catalog, merchant, immutable identity, checkout intent, payment/membership relationships, event resource and dates. Payment has no historical invoice-period ID in SDK 2.7.0. Only `subscription_create`/`subscription_cycle` with `periodProven:true`, both creation and payment timestamps inside the current paid period, exact configured subtotal/currency, and unambiguous persisted checkout binding can mint. Ambiguous historical invoices, upgrades and proration are retained for review. Unknown external purchases cannot automatically establish a user binding. Do not infer `periodProven` merely from membership's current period.

## Accounting and revocation

Billing access is separate from operator `generation_account_limits.enabled`, caps, kill switch and provider prices. Both reservation and dispatch claims require current paid billing. Disabled/unconfigured billing denies paid generation. Payment code never changes operator settings. Cancellation at period end keeps paid access until the paid end; invalid/inactive/past-due/revoked status denies immediately. Refund/dispute facts latch a review hold; a later ordinary active snapshot cannot clear it automatically.

`billing_receive_webhook` also accepts a bounded `p_evidence` object containing only the signed activation period (`membershipId`, `paymentId`, `periodStart`, `periodEnd`). `billing_due_receipts` returns that evidence for the Inngest reconciliation function. Provider retrieval happens after the durable receipt transaction; failures defer the receipt with bounded backoff.

Each unique paid collection creates a nonrollover credit bucket expiring at that paid period's end. Reservation records which bucket credits it consumed. An unclaimed release restores only unexpired paid allocations; expired paid credits do not revive. Existing manually funded balances are preserved as legacy credits without a new automatic grant; they still confer no billing access. Expiry, revocation and refunds never erase in-flight monetary holds, counters, provider bindings or settlement evidence. Claimed/ambiguous reservations keep their existing settlement/reconciliation rules. No automatic money refund, credit clawback, provider cancellation, upgrade/proration grant or merchant mutation is implemented.
