import { observeRequest } from "@/lib/observability/request";
import { authClients } from "@/lib/auth/server";
import { authError, authJson } from "@/lib/auth/handlers";
import { AuthFailure, readAuthBody, requireSameOrigin } from "@/lib/auth/security";
import { createEntitlementService, type ReserveGenerationInput } from "@/lib/entitlements/service";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function input(body: Record<string, unknown>): ReserveGenerationInput {
  const allowed = new Set(["projectId", "requestKey", "priceKey", "label", "prompt"]);
  if (Object.keys(body).some((key) => !allowed.has(key)) ||
    typeof body.projectId !== "string" || typeof body.requestKey !== "string" ||
    typeof body.priceKey !== "string" || typeof body.prompt !== "string" ||
    (body.label !== undefined && typeof body.label !== "string")) {
    throw new AuthFailure("Invalid generation request.", 400);
  }
  return {
    projectId: body.projectId,
    requestKey: body.requestKey,
    priceKey: body.priceKey,
    prompt: body.prompt,
    ...(typeof body.label === "string" ? { label: body.label } : {}),
  };
}

/** Reserve entitlement before any provider dispatch. No provider is called here. */
export async function POST(request: Request) {
  return observeRequest(request, "generation", async () => {
    try {
      requireEdgeOrigin(request);
      const clients = await authClients();
      requireSameOrigin(request, clients.config.origin);
      const body = await readAuthBody(request);
      const reservation = await createEntitlementService({ user: clients.client, admin: clients.admin })
        .reserveForUser(input(body));
      return authJson({ reservation }, 202);
    } catch (error) {
      return authError(error);
    }
  });
}
