import { observeRequest } from "@/lib/observability/request";
import { handleStorageRequest } from "@/lib/storage/handlers";
import { authJson } from "@/lib/auth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Context = { params: Promise<{ projectId: string; objectId: string; action: string }> };
export async function POST(request: Request, context: Context) {
  return observeRequest(request, "authorization", async () => {
    const params = await context.params;
    if (params.action !== "complete" && params.action !== "download" && params.action !== "delete") return authJson({ error: "Not found." }, 404);
    return handleStorageRequest(request, params, params.action);
  });
}
