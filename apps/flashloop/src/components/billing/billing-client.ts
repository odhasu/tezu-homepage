import { monthlyPlan, type BillingTier } from "@/lib/billing/catalog";

export type BillingSummary = {
  linked: boolean;
  available: boolean;
  credits: number;
  subscription: null | {
    tier: BillingTier;
    status: string;
    periodEnd: string;
    cancelAtPeriodEnd: boolean;
  };
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseBillingSummary(value: unknown): BillingSummary | null {
  if (!record(value) || typeof value.linked !== "boolean" || typeof value.available !== "boolean"
    || !Number.isSafeInteger(value.credits) || (value.credits as number) < 0) return null;
  let subscription: BillingSummary["subscription"] = null;
  if (value.subscription !== null) {
    const item = value.subscription;
    if (!record(item) || !monthlyPlan(item.tier) || typeof item.status !== "string"
      || !/^[a-z_]{1,40}$/.test(item.status) || typeof item.periodEnd !== "string"
      || !/^\d{4}-\d{2}-\d{2}T/.test(item.periodEnd) || !Number.isFinite(Date.parse(item.periodEnd))
      || typeof item.cancelAtPeriodEnd !== "boolean") return null;
    const periodEnd = new Date(item.periodEnd).getTime();
    if (periodEnd > Date.now()) {
      subscription = {
        tier: monthlyPlan(item.tier)!.tier,
        status: item.status,
        periodEnd: item.periodEnd,
        cancelAtPeriodEnd: item.cancelAtPeriodEnd,
      };
    }
  }
  return { linked: value.linked, available: value.available, credits: value.credits as number, subscription };
}

export function whopNavigationUrl(value: unknown): string | null {
  if (!record(value) || typeof value.url !== "string" || value.url.length > 4096) return null;
  try {
    const url = new URL(value.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
      || !["whop.com", "api.whop.com", "sandbox.whop.com"].includes(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function subscriptionStatus(status: string): string {
  switch (status) {
    case "active": return "Active";
    case "trialing": return "Trial period";
    case "past_due": return "Payment needed";
    case "canceled":
    case "cancelled": return "Canceled";
    case "expired": return "Expired";
    case "unpaid": return "Payment needed";
    default: return "Needs review";
  }
}
