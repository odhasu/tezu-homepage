import "server-only";

import { AuthFailure } from "@/lib/auth/security";
import type { BillingConfig, BillingEnvironment, BillingPurpose, BillingTier } from "./types";

const API_VERSION_DATE = "2026-10-28" as const;
const TIER_NAMES: BillingTier[] = ["starter", "plus", "ultra-3k", "ultra-6k", "ultra-9k"];
const WHOP_ID = /^(biz|plan|prod|ch|mem|pay)_[A-Za-z0-9]+$/;

export class BillingConfigurationError extends AuthFailure {
  constructor(message = "Billing is not configured yet.") { super(message, 503, 60); }
}

function value(name: string): string | undefined {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : undefined;
}
function bool(name: string): boolean { return value(name) === "true"; }
function env(): BillingEnvironment {
  const raw = value("WHOP_ENVIRONMENT");
  const deployment = value("BILLING_ENVIRONMENT");
  if ((deployment !== "staging" && deployment !== "production") ||
    (raw !== "sandbox" && raw !== "production") ||
    (deployment === "staging" && raw !== "sandbox") || (deployment === "production" && raw !== "production")) throw new BillingConfigurationError("Billing environment must be configured explicitly.");
  if (process.env.VERCEL_ENV === "production" && deployment !== "production") throw new BillingConfigurationError("Billing environment does not match this deployment.");
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && deployment === "production") throw new BillingConfigurationError("Live billing is disabled in preview deployments.");
  return raw;
}

export function billingConfig(purpose: BillingPurpose = "checkout"): BillingConfig {
  const environment = env();
  const accountId = value("WHOP_ACCOUNT_ID");
  const productId = value("WHOP_PRODUCT_ID");
  const origin = value("AUTH_ORIGIN");
  if (!accountId || !WHOP_ID.test(accountId) || !accountId.startsWith("biz_") || !productId || !/^prod_[A-Za-z0-9]+$/.test(productId) || !origin) {
    throw new BillingConfigurationError();
  }
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
    if (originUrl.origin !== origin || (originUrl.protocol !== "https:" && process.env.NODE_ENV !== "development")) throw new Error();
  } catch { throw new BillingConfigurationError("Billing origin is invalid."); }

  const variants = {} as Record<BillingTier, string>;
  for (const tier of TIER_NAMES) {
    const id = value(`WHOP_VARIANT_${tier.toUpperCase().replaceAll("-", "_")}`);
    if (id) {
      if (!id.startsWith("plan_") || !WHOP_ID.test(id)) throw new BillingConfigurationError("Billing catalog is invalid.");
      variants[tier] = id;
    }
  }
  if ((purpose === "checkout" || purpose === "reconciliation") && TIER_NAMES.some((tier) => !variants[tier])) throw new BillingConfigurationError("Billing catalog is incomplete.");
  const webhookSecret = value("WHOP_WEBHOOK_SECRET");
  if (purpose === "webhook" && !webhookSecret) throw new BillingConfigurationError("Billing webhook is not configured yet.");
  if (purpose === "oauth" && (!value("WHOP_OAUTH_CLIENT_ID") || !value("WHOP_OAUTH_REDIRECT_URI"))) throw new BillingConfigurationError("Whop sign-in is not configured yet.");
  return {
    environment, accountId, productId, deployment: value("BILLING_ENVIRONMENT") as "staging" | "production", origin: originUrl.origin, apiVersionDate: API_VERSION_DATE,
    variants, enabled: bool("BILLING_ENABLED"), webhooksEnabled: bool("WHOP_WEBHOOKS_ENABLED"),
    fulfillEnabled: bool("BILLING_FULFILL_ENABLED"), webhookSecret,
  };
}

export function requireBillingEnabled(purpose: BillingPurpose): BillingConfig {
  const config = billingConfig(purpose);
  if (purpose === "checkout" && (!config.enabled || !config.fulfillEnabled)) throw new BillingConfigurationError("Checkout fulfillment is not enabled.");
  if (purpose === "webhook" && !config.webhooksEnabled) throw new BillingConfigurationError("Billing webhooks are not enabled.");
  return config;
}
