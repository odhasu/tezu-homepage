import { observeRequest } from "@/lib/observability/request";
import { handleBillingLinkPost, handleBillingManagePost } from "@/lib/billing/handlers";
import { authJson } from "@/lib/auth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  const operation = (await params).operation;
  return observeRequest(request, "authorization", async () => {
    if (operation === "link") return handleBillingLinkPost(request);
    if (operation === "manage") return handleBillingManagePost(request);
    return authJson({ error: "Not found." }, 404);
  });
}
