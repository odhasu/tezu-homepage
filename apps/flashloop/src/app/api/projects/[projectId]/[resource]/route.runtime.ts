import { observeRequest } from "@/lib/observability/request";
import { handleOwnedRequest } from "@/lib/ownership/handlers";

export const runtime = "nodejs";
type Context = { params: Promise<{ projectId: string; resource: string }> };

export async function GET(request: Request, context: Context) {
  return observeRequest(request, "authorization", async () => {
    return handleOwnedRequest(request, await context.params);
  });
}
export async function POST(request: Request, context: Context) {
  return observeRequest(request, "authorization", async () => {
    return handleOwnedRequest(request, await context.params);
  });
}
