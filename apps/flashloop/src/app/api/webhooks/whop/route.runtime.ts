import { observeRequest } from "@/lib/observability/request";
import { handleWhopWebhookPost } from "@/lib/billing/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return observeRequest(request, "webhook", () => handleWhopWebhookPost(request));
}
