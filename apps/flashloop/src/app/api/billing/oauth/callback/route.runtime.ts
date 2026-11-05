import { observeRequest } from "@/lib/observability/request";
import { handleBillingOAuthCallback } from "@/lib/billing/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return observeRequest(request, "authorization", () => handleBillingOAuthCallback(request));
}
