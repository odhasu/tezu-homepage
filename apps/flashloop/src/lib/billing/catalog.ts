export const MONTHLY_PLANS = [
  { tier: "starter", name: "Starter", credits: 270, currency: "EUR", initialPriceCents: 1900, renewalPriceCents: 1900 },
  { tier: "plus", name: "Plus", credits: 1200, currency: "EUR", initialPriceCents: 5900, renewalPriceCents: 5900 },
  { tier: "ultra-3k", name: "Ultra 3K", credits: 3000, currency: "EUR", initialPriceCents: 12900, renewalPriceCents: 12900 },
  // Whop recurring variants charge initial_price + renewal_price up front.
  // Keep these at the safe recurring price until a supported first-period
  // discount mechanism is configured and verified.
  { tier: "ultra-6k", name: "Ultra 6K", credits: 6000, currency: "EUR", initialPriceCents: 25000, renewalPriceCents: 25000 },
  { tier: "ultra-9k", name: "Ultra 9K", credits: 9000, currency: "EUR", initialPriceCents: 37500, renewalPriceCents: 37500 },
] as const;

export type BillingTier = (typeof MONTHLY_PLANS)[number]["tier"];

export function monthlyPlan(tier: unknown) {
  return typeof tier === "string" ? MONTHLY_PLANS.find((plan) => plan.tier === tier) : undefined;
}

export function formatEuro(cents: number) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
