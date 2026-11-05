import "server-only";
import { authClients } from "@/lib/auth/server";
import { authError, authJson } from "@/lib/auth/handlers";
import { AuthFailure, readAuthBody, requireSameOrigin } from "@/lib/auth/security";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";
import { createPrivateStorageService } from "./service";

export async function handleStorageRequest(request: Request, params: { projectId: string; objectId?: string }, action: "upload" | "complete" | "download" | "delete") {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients();
    // Signing is a mutation: even download links require same-origin POST.
    requireSameOrigin(request, clients.config.origin);
    const body = await readAuthBody(request);
    if (action !== "upload" && Object.keys(body).length) throw new AuthFailure("Unexpected object fields.", 400);
    const service = createPrivateStorageService(clients);
    if (action === "upload") return authJson(await service.reserveUpload(params.projectId, body), 201);
    if (!params.objectId) throw new AuthFailure("Not found.", 404);
    if (action === "complete") return authJson(await service.completeUpload(params.projectId, params.objectId));
    if (action === "download") return authJson(await service.download(params.projectId, params.objectId));
    await service.remove(params.projectId, params.objectId);
    return authJson({ cleanupScheduled: true }, 202);
  } catch (error) { return authError(error); }
}
