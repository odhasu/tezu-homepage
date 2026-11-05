import type { ErrorEvent, NodeOptions } from "@sentry/node";
import { safeCorrelation, type Correlation } from "./correlation";
import type { SentryConfig } from "./sentry-config";

export const telemetryOperations = [
  "signup", "signin", "signout", "verification", "authorization", "generation", "quota_rejection", "webhook",
  "generation_job", "generation_outbox", "storage_cleanup", "framework", "staging_probe",
] as const;
export type TelemetryOperation = typeof telemetryOperations[number];
type StreamedSpan = Parameters<NonNullable<NodeOptions["beforeSendSpan"]>>[0];
const operations = new Set<string>(telemetryOperations);
const hex = (value: unknown, length: number): value is string => typeof value === "string" &&
  new RegExp(`^[a-f0-9]{${length}}$`, "i").test(value);

export function telemetryOperation(value: unknown): TelemetryOperation | null {
  return typeof value === "string" && operations.has(value) ? value as TelemetryOperation : null;
}

export function correlationTags(correlation: Correlation): Record<string, string> {
  return Object.fromEntries(Object.entries(safeCorrelation(correlation)).map(([key, value]) => [key, value]));
}

/** Rebuild the whole event; never forward exception messages, stacks or ambient scope data. */
export function safeSentryEvent(event: ErrorEvent, config: SentryConfig): ErrorEvent | null {
  const operation = telemetryOperation(event.tags?.operation);
  if (!operation) return null;
  const tags = correlationTags({
    requestId: typeof event.tags?.requestId === "string" ? event.tags.requestId : undefined,
    jobId: typeof event.tags?.jobId === "string" ? event.tags.jobId : undefined,
    generationRequestId: typeof event.tags?.generationRequestId === "string" ? event.tags.generationRequestId : undefined,
  });
  const trace = event.contexts?.trace;
  return {
    type: undefined,
    ...(hex(event.event_id, 32) ? { event_id: event.event_id } : {}),
    ...(typeof event.timestamp === "number" && Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
    platform: "node",
    level: "error",
    environment: config.environment,
    release: config.release,
    exception: { values: [{ type: "FlashloopOperationError", value: `${operation} failed.` }] },
    fingerprint: ["flashloop", operation],
    tags: { operation, ...tags },
    ...(trace && hex(trace.trace_id, 32) && hex(trace.span_id, 16) ? {
      contexts: { trace: { trace_id: trace.trace_id, span_id: trace.span_id, op: "flashloop.operation" } },
    } : {}),
  };
}

/** Sentry 11 streams spans; this hook runs after scope/SDK enrichment. */
export function safeSentrySpan(span: StreamedSpan, config: SentryConfig): StreamedSpan {
  const operation = telemetryOperation(span.name) ?? "framework";
  const attributes = span.attributes ?? {};
  return {
    trace_id: hex(span.trace_id, 32) ? span.trace_id : "00000000000000000000000000000000",
    span_id: hex(span.span_id, 16) ? span.span_id : "0000000000000000",
    ...(hex(span.parent_span_id, 16) ? { parent_span_id: span.parent_span_id } : {}),
    name: operation,
    start_timestamp: Number.isFinite(span.start_timestamp) ? span.start_timestamp : 0,
    ...(typeof span.end_timestamp === "number" && Number.isFinite(span.end_timestamp) ? { end_timestamp: span.end_timestamp } : {}),
    status: span.status === "ok" ? "ok" : "error",
    is_segment: span.is_segment === true,
    attributes: {
      "sentry.op": "flashloop.operation",
      "sentry.origin": "manual",
      "sentry.environment": config.environment,
      "sentry.release": config.release,
      ...correlationTags({
        requestId: typeof attributes.requestId === "string" ? attributes.requestId : undefined,
        jobId: typeof attributes.jobId === "string" ? attributes.jobId : undefined,
        generationRequestId: typeof attributes.generationRequestId === "string" ? attributes.generationRequestId : undefined,
      }),
    },
  };
}
