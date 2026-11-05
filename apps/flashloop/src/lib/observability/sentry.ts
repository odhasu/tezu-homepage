import "server-only";

import * as Sentry from "@sentry/node";
import { safeCorrelation, type Correlation } from "./correlation";
import { sentryConfig } from "./sentry-config";
import { correlationTags, safeSentryEvent, safeSentrySpan, telemetryOperation, type TelemetryOperation } from "./sentry-privacy";

let initialized = false;

export function initializeSentry(): boolean {
  if (!sentryConfig()) return false;
  if (initialized) return true;
  const config = sentryConfig();
  if (!config) return false;
  try {
    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      serverName: "flashloop",
      debug: false,
      spotlight: false,
      defaultIntegrations: false,
      // This integration buffers only the explicitly created manual spans.
      integrations: [Sentry.spanStreamingIntegration()],
      enableRuntimeChannelInjection: false,
      enableOpenTelemetrySetup: false,
      traceLifecycle: "stream",
      tracesSampleRate: config.tracesSampleRate,
      tracePropagationTargets: [],
      strictTraceContinuation: true,
      maxBreadcrumbs: 0,
      attachStacktrace: false,
      includeLocalVariables: false,
      sendClientReports: false,
      dataCollection: {
        userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
        graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false },
        mcp: { inputs: false, outputs: false }, databaseQueryData: false, queues: false,
        stackFrameVariables: false, frameContextLines: 0,
      },
      beforeBreadcrumb: () => null,
      beforeSendLog: () => null,
      beforeSendMetric: () => null,
      beforeSend(event, hint) {
        hint.attachments = [];
        return safeSentryEvent(event, config);
      },
      beforeSendSpan: (span) => safeSentrySpan(span, config),
    });
    initialized = true;
    return true;
  } catch { return false; }
}

/** Fixed error classes only. Callers must never pass the caught error or provider diagnostics. */
export function reportFailure(operation: TelemetryOperation, correlation: Correlation = {}): string | undefined {
  if (!telemetryOperation(operation) || !initializeSentry()) return undefined;
  try {
    return Sentry.captureEvent({
      level: "error",
      exception: { values: [{ type: "FlashloopOperationError", value: `${operation} failed.` }] },
      tags: { operation, ...correlationTags(correlation) },
    });
  } catch { return undefined; }
}

/** Mark handled 5xx responses on the active manual span without throwing a sentinel. */
export function markOperationFailed(): void {
  try { Sentry.getActiveSpan()?.setStatus({ code: 2 }); }
  catch { /* Telemetry must not change the application response. */ }
}

/** Keep telemetry failure independent from application success and preserve original failures. */
export async function traceOperation<T>(
  operation: TelemetryOperation,
  correlation: Correlation,
  callback: () => Promise<T>,
): Promise<T> {
  if (!telemetryOperation(operation) || !initializeSentry()) return callback();
  let executed = false;
  let failed = false;
  let result: T | undefined;
  let failure: unknown;
  try {
    return await Sentry.withIsolationScope(() => Sentry.startNewTrace(() => Sentry.startSpan({
      name: operation,
      op: "flashloop.operation",
      attributes: correlationTags(correlation),
    }, async (span) => {
      executed = true;
      try {
        result = await callback();
        return result;
      } catch (error) {
        failed = true;
        failure = error;
        reportFailure(operation, correlation);
        throw error;
      } finally {
        // Wrappers add persisted job IDs only after authorization/lookup succeeds.
        span.setAttributes(correlationTags(safeCorrelation(correlation)));
      }
    })));
  } catch {
    if (!executed) return callback();
    if (failed) throw failure;
    return result as T;
  }
}

export async function flushTelemetry(timeoutMs = 2000): Promise<boolean> {
  if (!initializeSentry()) return false;
  try { return await Sentry.flush(Math.max(1, Math.min(timeoutMs, 5000))); }
  catch { return false; }
}

export type { Correlation, TelemetryOperation };
