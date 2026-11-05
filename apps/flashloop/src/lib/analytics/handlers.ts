import "server-only";

import { after } from "next/server";
import { privateResponse } from "@/lib/http/cache-policy";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";
import { AuthFailure, requireSameOrigin } from "@/lib/auth/security";
import { ANALYTICS_PAGES, type AnalyticsPage } from "./consent";
import { analyticsConfig, capturePageview } from "./server";

export async function handleAnalyticsPageview(request: Request): Promise<Response> {
  const reply = (status: number) => privateResponse(new Response(null, { status }));
  try {
    requireEdgeOrigin(request);
    const originValue = process.env.AUTH_ORIGIN;
    if (!originValue || !analyticsConfig()) return reply(204);
    const origin = new URL(originValue);
    if (origin.origin !== originValue || (origin.protocol !== "https:" &&
      !(process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(origin.hostname)))) return reply(503);
    requireSameOrigin(request, originValue);
    const length = request.headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > 100)) return reply(413);
    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    let body = "";
    let bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 100) { await reader.cancel(); return reply(413); }
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) return reply(400);
    const data = value as Record<string, unknown>;
    if (Object.keys(data).length !== 1 || typeof data.page !== "string" ||
      !(ANALYTICS_PAGES as readonly string[]).includes(data.page)) return reply(400);
    // Keep navigation independent from the optional analytics transport. `after`
    // lets Next.js flush the best-effort event after the 204 response is ready.
    after(() => capturePageview(request, data.page as AnalyticsPage));
    return reply(204);
  } catch (error) { return reply(error instanceof AuthFailure ? error.status : 400); }
}
