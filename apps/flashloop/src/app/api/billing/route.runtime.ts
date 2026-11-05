import { observeRequest } from "@/lib/observability/request";
import { handleBillingGet } from "@/lib/billing/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return observeRequest(request, "authorization", () => handleBillingGet(request));
}
