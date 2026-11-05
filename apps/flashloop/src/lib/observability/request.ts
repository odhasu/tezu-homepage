import "server-only";

import { after } from "next/server";
import { captureAnalytics, type AnalyticsEvent } from "@/lib/analytics/server";
import { privateResponse } from "@/lib/http/cache-policy";
import { newRequestId, safeCorrelation, type Correlation } from "./correlation";
import { flushTelemetry, markOperationFailed, reportFailure, traceOperation } from "./sentry";

export type RequestOperation = "signup" | "signin" | "verification" | "authorization" | "generation" | "webhook";

/** Only trusted response identifiers are shared with a background job or callback. */
async function responseCorrelation(response: Response, operation: RequestOperation): Promise<Correlation> {
  if (!response.ok || (operation !== "generation" && operation !== "webhook")) return {};
  try {
    const body: unknown = await response.clone().json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    const record = body as Record<string, unknown>;
    const source = operation === "generation" ? record.reservation : record.result;
    if (!source || typeof source !== "object" || Array.isArray(source)) return {};
    const ids = source as Record<string, unknown>;
    return safeCorrelation({ generationRequestId: ids.requestId, jobId: ids.jobId });
  } catch { return {}; }
}

/** Observability never supplies authorization, consumes bodies, or trusts incoming IDs. */
export async function observeRequest(
  request: Request,
  operation: RequestOperation,
  handler: () => Promise<Response>,
): Promise<Response> {
  const requestId = newRequestId();
  const correlation: Correlation = { requestId };
  const response = await traceOperation(operation, correlation, async () => {
    let result: Response;
    try { result = await handler(); }
    catch {
      // Never send the thrown object, message, request URL, headers, or body to a sink.
      result = Response.json({ error: "Service unavailable. Try again." }, { status: 503 });
    }
    Object.assign(correlation, await responseCorrelation(result, operation));
    if (result.status >= 500) {
      markOperationFailed();
      reportFailure(operation, correlation);
    }
    return privateResponse(result);
  });
  response.headers.set("X-Request-ID", requestId);
  const properties = { ...correlation, requestId, operation, httpStatus: response.status };
  const events: AnalyticsEvent[] = [operation];
  // These are outcome observations, never grants of account access or entitlement.
  if (operation !== "authorization" && [401, 403].includes(response.status)) events.push("authorization");
  if ([402, 429].includes(response.status)) events.push("quota_rejection");
  after(async () => {
    await Promise.allSettled([
      ...events.map((event) => captureAnalytics(request, event, properties)),
      flushTelemetry(),
    ]);
  });
  return response;
}

export function authOperation(operation: string): RequestOperation {
  if (operation === "signup" || operation === "signin") return operation;
  if (operation === "verify" || operation === "callback") return "verification";
  return "authorization";
}
