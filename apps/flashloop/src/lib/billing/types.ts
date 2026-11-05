import type { WhopClient } from "@whop/sdk";

export type BillingEnvironment = "sandbox" | "production";
export type BillingTier = "starter" | "plus" | "ultra-3k" | "ultra-6k" | "ultra-9k";
export type BillingPurpose = "checkout" | "webhook" | "reconciliation" | "oauth";

export interface BillingConfig {
  environment: BillingEnvironment;
  accountId: string;
  productId: string;
  deployment: "staging" | "production";
  origin: string;
  apiVersionDate: "2026-10-28";
  variants: Readonly<Record<BillingTier, string>>;
  enabled: boolean;
  webhooksEnabled: boolean;
  fulfillEnabled: boolean;
  webhookSecret?: string;
}

export interface CheckoutResult {
  id: string;
  purchaseUrl: string;
  tier: BillingTier;
  variantId: string;
}

export interface BillingCheckoutSnapshot {
  id: string;
  accountId: string;
  variantId: string | null;
  metadata: Record<string, unknown> | null;
  purchaseUrl: string | null;
  redirectUrl: string | null;
}

export interface WhopMembershipSnapshot {
  id: string;
  accountId: string;
  whopUserId: string | null;
  planKey: BillingTier | null;
  variantId: string;
  planId: string;
  productId: string;
  status: string;
  valid: boolean;
  createdAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  manageUrl: string | null;
  checkoutId: string | null;
}

export interface WhopPaymentSnapshot {
  id: string;
  accountId: string | null;
  status: string;
  paid: boolean;
  refunded: boolean;
  disputed: boolean;
  billingReason: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  createdAt: string;
  paidAt: string | null;
  membershipId: string | null;
  variantId: string | null;
  planId: string | null;
  checkoutId: string | null;
  periodProven: boolean;
}

export interface BillingSnapshot {
  environment: BillingEnvironment;
  companyId: string;
  whopUserId: string | null;
  observedAt: string;
  membership: WhopMembershipSnapshot | null;
  payment: WhopPaymentSnapshot | null;
}

export type WhopEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.requires_action"
  | "membership.activated"
  | "membership.updated"
  | "refund.created"
  | "refund.updated"
  | "dispute.created"
  | "dispute.updated"
  | "dispute_alert.created";

export interface VerifiedWhopEvent {
  eventId: string;
  type: WhopEventType;
  accountId: string | null;
  apiVersion: string | null;
  apiVersionDate: string | null;
  resourceId: string | null;
  data: unknown;
  receivedAt: string;
}

export interface WhopClientLike {
  checkoutConfigurations: Pick<WhopClient["checkoutConfigurations"], "create" | "retrieve">;
  memberships: Pick<WhopClient["memberships"], "retrieve">;
  payments: Pick<WhopClient["payments"], "retrieve" | "list">;
  variants: Pick<WhopClient["variants"], "retrieve">;
  refunds: Pick<WhopClient["refunds"], "retrieve">;
  disputes: Pick<WhopClient["disputes"], "retrieve">;
  disputeAlerts: Pick<WhopClient["disputeAlerts"], "retrieve">;
}
