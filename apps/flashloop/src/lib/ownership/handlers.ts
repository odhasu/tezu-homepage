import "server-only";
import { authUserClient } from "@/lib/auth/server";
import { authError, authJson } from "@/lib/auth/handlers";
import { AuthFailure, readAuthBody, requireSameOrigin } from "@/lib/auth/security";
import { createOwnedStore, resourceName, type Operation } from "./store";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";

type Params = { projectId?: string; resource?: string; recordId?: string };

export async function handleOwnedRequest(request: Request, params: Params = {}, profile = false) {
  try {
    requireEdgeOrigin(request);
    const clients = await authUserClient();
    const mutation = request.method !== "GET";
    if (mutation) requireSameOrigin(request, clients.config.origin);
    const table = profile ? "accounts" : params.resource ? resourceName(params.resource) : "projects";
    const id = params.recordId ?? (!params.resource ? params.projectId : undefined);
    const operations: Record<string, Operation> = {
      GET: profile || id ? "read" : "list", POST: "create", PATCH: "update", DELETE: "delete",
    };
    const operation = operations[request.method];
    if (!operation) throw new AuthFailure("Method not allowed.", 405);
    const body = operation === "create" || operation === "update" ? await readAuthBody(request) : undefined;
    // Never pass the admin client to ownership operations.
    const data = await createOwnedStore(clients.client).execute(table, operation, {
      id, projectId: params.resource ? params.projectId : undefined, body,
    });
    return authJson({ data }, operation === "create" ? 201 : 200);
  } catch (error) { return authError(error); }
}
