import { observeRequest } from "@/lib/observability/request";
import { authClients, requireProtectedSession } from "@/lib/auth/server";
import { authError, authJson } from "@/lib/auth/handlers";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return observeRequest(request, "authorization", async () => {
    try {
      requireEdgeOrigin(request);
      const context = await requireProtectedSession(await authClients());
      return authJson({ userId: context.user_id, videoCredits: context.credits });
    } catch (error) { return authError(error); }
  });
}
