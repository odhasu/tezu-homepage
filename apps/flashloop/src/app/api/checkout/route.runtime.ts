import { observeRequest } from "@/lib/observability/request";
import { handleCheckoutPost } from "@/lib/checkout/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return observeRequest(request, "authorization", async () => {
    return handleCheckoutPost(request);
  });
}
