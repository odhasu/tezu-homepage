import { observeRequest } from "@/lib/observability/request";
import { handleStorageRequest } from "@/lib/storage/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };
export async function POST(request: Request, context: Context) {
  return observeRequest(request, "authorization", async () => {
    return handleStorageRequest(request, await context.params, "upload");
  });
}
