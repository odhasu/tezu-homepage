import "server-only";

import { authError, authJson } from "@/lib/auth/handlers";
import { AuthFailure } from "@/lib/auth/security";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";
import { storageAdminClient } from "@/lib/storage/admin";
import { generationAdapter, type GenerationAdapter } from "./providers";
import { applyGenerationCallback, MAX_CALLBACK_BYTES } from "./webhooks";

type RouteContext = { params: Promise<{ provider: string }> };
type HandlerDeps = {
  adapters?: Map<string, GenerationAdapter> | Record<string, GenerationAdapter>;
  client?: { rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
  clientFactory?: () => HandlerDeps["client"];
};

function resolveAdapter(id: string, deps: HandlerDeps): GenerationAdapter {
  const adapter = deps.adapters instanceof Map ? deps.adapters.get(id) : deps.adapters?.[id];
  return adapter ?? generationAdapter(id);
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(await request.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_CALLBACK_BYTES) {
        await reader.cancel();
        throw new AuthFailure("Generation callback is too large.", 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export function createGenerationWebhookHandler(deps: HandlerDeps = {}) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    try {
      requireEdgeOrigin(request);
      const { provider } = await context.params;
      // Resolve before constructing service clients. Unknown providers must not
      // cause database access or reveal whether a job exists.
      const adapter = resolveAdapter(provider, deps);
      if (process.env.GENERATION_WEBHOOKS_ENABLED !== "true") {
        throw new AuthFailure("Generation webhooks are disabled.", 503);
      }
      const length = request.headers.get("content-length");
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_CALLBACK_BYTES)) {
        throw new AuthFailure("Generation callback is too large.", 413);
      }
      const raw = await readBoundedBody(request);
      if (raw.byteLength > MAX_CALLBACK_BYTES) throw new AuthFailure("Generation callback is too large.", 413);
      const client = deps.client ?? deps.clientFactory?.() ?? storageAdminClient();
      if (!client) throw new AuthFailure("Generation callback unavailable.", 503);
      const result = await applyGenerationCallback({
        provider,
        adapter,
        client: client as Parameters<typeof applyGenerationCallback>[0]["client"],
        rawBody: raw,
        headers: request.headers,
      });
      return authJson({ ok: true, result });
    } catch (error) {
      return authError(error);
    }
  };
}

export type { HandlerDeps as GenerationWebhookHandlerDeps, RouteContext as GenerationWebhookRouteContext };
