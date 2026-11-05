import { observeRequest } from "@/lib/observability/request";
import { createGenerationWebhookHandler } from "@/lib/generation/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ provider: string }> }): Promise<Response> {
  return observeRequest(request, "webhook", async () => {
    return createGenerationWebhookHandler()(request, context);
  });
}
