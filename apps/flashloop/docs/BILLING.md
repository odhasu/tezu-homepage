# Whop monthly subscriptions

Updated 5 November 2026. The user's current instruction supersedes the earlier payment deferral: use Whop and copy Higgsfield's **individual monthly** subscriptions. Team/Scale shared workspaces and annual billing are outside this request.

## Reference and merchant catalog

The signed-in Higgsfield pricing page at <https://higgsfield.ai/pricing> was inspected with Monthly selected on 5 November 2026. EUR was the displayed regional currency. The credit policy at <https://higgsfield.ai/creator-hub/help-center/credits/how-credits-work> states that individual subscription credits do not roll over. Cancellation ends future renewals and keeps the paid period; failed renewal does not mint credits. These commercial choices do not imply that Flashloop offers Higgsfield's models, unlimited promotions, support, SSO, or compliance guarantees.

| Tier | Credits per paid period | First period | Recurring price | Whop variant |
| --- | ---: | ---: | ---: | --- |
| Starter | 270 | €19 | €19 | `plan_OklDEs89nWoov` |
| Plus | 1,200 | €59 | €59 | `plan_tDphwtjpyfkBX` |
| Ultra 3K | 3,000 | €129 | €129 | `plan_RreFDkenMmWT7` |
| Ultra 6K | 6,000 | €250 | €250 | `plan_cwkFfPeYXxAiZ` |
| Ultra 9K | 9,000 | €375 | €375 | `plan_NZuwjpn18aoHf` |

The official Whop CLI `@whop/cli@0.34.1` created a new **hidden** Flashloop product `prod_6sexFVZ6atqvJ` and the five **hidden** renewal variants in the authorized Brilliance business `biz_TWAJfCZDIBbFOk`. `billing_period=30` is Whop's documented monthly interval. Whop's recurring `initial_price_due` is `initial_price + renewal_price`, so each variant was corrected to `initial_price=0` and a single monthly renewal price. The larger Higgsfield first-period promotional prices (€220/€310) are not represented until Whop's supported promotion mechanism is verified; no checkout can expose a mismatched price. CLI prices are numeric major currency units and currency is lowercase `eur`. The first Starter attempt with uppercase `EUR` was rejected; the corrected request used a separate idempotency key after the provider explicitly rejected reuse with different parameters. No duplicate Starter variant was created. Existing product `eeee` and its variant were preserved. No checkout, charge, refund, cancellation, or customer message was initiated.

CLI authentication uses the existing OAuth profile and macOS Keychain (`WHOP_CLI_SECRET_STORE=keyring`). Credentials were not extracted, printed, or copied into this repository. These IDs are public resource identifiers, not credentials. The CLI is production-only; these IDs **must not** be used in sandbox staging.

## Runtime contract and safety boundaries

The implementation reuses Next.js Route Handlers, verified Supabase sessions, the protected-origin and same-origin checks, PostgreSQL transactions, Inngest, safe Sentry correlation, and the existing private/no-store browser/CDN response policy. The installed SDK is `@whop/sdk@2.7.0`; runtime REST and webhook schema date is pinned to `2026-10-28`, separately from the newer CLI API date.

- `/pricing` displays the monthly catalog without touching user state. Static GitHub Pages exports cannot call billing APIs or take payments.
- `/account/billing` checks a live verified session and obtains an owner-only, uncached summary. Query parameters select a known tier or display a callback message; they never grant access.
- Whop OAuth PKCE proves the provider `sub` and binds it to the existing verified Supabase user/session. Never link by email, client claims, redirect parameters, or checkout metadata alone. A reusable hosted checkout URL does not bind its visitor to the Flashloop account.
- Checkout accepts a catalog tier and stable request key. A permanent local creation claim precedes the provider request. An ambiguous provider response stays unresolved; it is not automatically recreated after Whop's finite idempotency window.
- Webhooks must verify the exact bounded raw body with the installed Whop Standard Webhooks helper before a durable database receipt. Provider event IDs and payment IDs require independent permanent deduplication. Store only normalized IDs/status/period evidence and a payload hash, never customer content, full payloads, credentials, or signed URLs.
- Paid monthly buckets expire without rollover. Billing access is separate from trusted operator kill switches, account caps, and generation reservations. Cancellation/refund/dispute cannot erase obligations for an already claimed provider job.
- Unsupported upgrades, proration, transferred memberships, missing authoritative period evidence, and mismatched account/product/variant/owner evidence fail closed for manual reconciliation.

## Activation still required

The new catalog is hidden and application sales remain disabled. A live subscription is not operational merely because a local fixture or SDK signature test passes.

1. Provide an owned runtime domain and complete the existing Cloudflare protected-origin setup. Preserve the newer deployment checkout and GitHub Pages marketing preview.
2. Create a separate Whop sandbox account/catalog, OAuth application with exact callback `/api/billing/oauth/callback`, least-privilege runtime API credential, and signed webhook endpoint. Provision credentials directly into the appropriate environment secret store; never paste them into chat or notes. Production must use the production catalog above and separate keys/webhooks/OAuth configuration.
3. Review/apply the billing migration to the correct isolated environment after resolving the historical hosted migration drift. Do not replay the entire local chain against the existing staging database.
4. Configure the catalog and billing policy in the database with service-only operator calls. First-period promotions and renewal prices must both match the merchant variant. Keep payment acceptance disabled until generation fulfillment, provider pricing and global/account caps are actually available.
5. Enable/sync the Inngest billing reconciler and verify real sandbox purchase, renewal, duplicate/reordered callbacks, cancellation, refund/dispute, expiry, lost responses, and two-account browser/CDN isolation. Then review production activation separately.

Sentry/PostHog project separation, consent/privacy policy, alerts and live acceptance remain tracked in [OBSERVABILITY.md](OBSERVABILITY.md), [ANALYTICS.md](ANALYTICS.md), and [CACHING.md](CACHING.md).

## Verification

Verification is in progress. Only recorded commands and observed results should be added here. Hidden merchant catalog creation is real account state; local unit/SQL fixtures do not prove real checkout, fulfillment, authorization, or production security.

Official sources: [Whop CLI](https://docs.whop.com/cli/overview), [OAuth](https://docs.whop.com/developer/guides/oauth.md), [webhooks](https://docs.whop.com/developer/guides/webhooks), [memberships](https://docs.whop.com/developer/guides/memberships), [idempotency](https://docs.whop.com/developer/api/idempotency), [sandbox](https://docs.whop.com/developer/guides/sandbox).
