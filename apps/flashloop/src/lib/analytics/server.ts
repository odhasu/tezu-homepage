import "server-only";

import { randomUUID } from "node:crypto";
import { ANALYTICS_PAGES, readAnalyticsConsent, type AnalyticsPage } from "./consent";

const EVENTS = ["pageview", "signup", "signin", "verification", "authorization", "generation", "quota_rejection", "webhook"] as const;
const OPERATIONS = ["pageview", "signup", "signin", "verification", "authorization", "generation", "quota_rejection", "webhook",
  "generation_job", "generation_outbox", "storage_cleanup", "framework", "staging_probe"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AnalyticsEvent = typeof EVENTS[number];
export type AnalyticsProperties = {
  requestId: string;
  httpStatus: number;
  operation: typeof OPERATIONS[number];
  jobId?: string;
  generationRequestId?: string;
};

export function analyticsConfig() {
  const environment = process.env.TELEMETRY_ENVIRONMENT;
  if (process.env.STATIC_EXPORT === "true" || (environment !== "staging" && environment !== "production")) return null;
  const prefix = `POSTHOG_${environment.toUpperCase()}`;
  const host = process.env[`${prefix}_HOST`];
  const token = process.env[`${prefix}_PROJECT_TOKEN`];
  const version = process.env.ANALYTICS_CONSENT_POLICY_VERSION;
  if (process.env[`${prefix}_ENABLED`] !== "true" || process.env.ANALYTICS_CONSENT_POLICY_APPROVED !== "true" ||
    !version || !/^[a-z0-9][a-z0-9._-]{0,39}$/.test(version) || !token || token.length > 300 || token.trim() !== token ||
    !["https://eu.i.posthog.com", "https://us.i.posthog.com"].includes(host ?? "")) return null;
  // Refuse accidental reuse when both projects have been supplied in this runtime.
  if (process.env.POSTHOG_STAGING_PROJECT_TOKEN && process.env.POSTHOG_STAGING_PROJECT_TOKEN === process.env.POSTHOG_PRODUCTION_PROJECT_TOKEN) return null;
  return { environment, host: host!, token, policyVersion: `${environment}.${version}` };
}

/** Safe to pass to the browser: no project token or destination is included. */
export function analyticsClientConfig(): { policyVersion: string } | null {
  const config = analyticsConfig();
  return config ? { policyVersion: config.policyVersion } : null;
}

export function analyticsAllowed(request: Request, policyVersion: string): boolean {
  return request.headers.get("sec-gpc") !== "1" && request.headers.get("dnt") !== "1" &&
    readAnalyticsConsent(request.headers.get("cookie") ?? "", policyVersion) === "granted";
}

/** Build from exact fields rather than redacting arbitrary caller data afterward. */
function safeProperties(input: AnalyticsProperties) {
  if (!input || !UUID.test(input.requestId) || !Number.isInteger(input.httpStatus) || input.httpStatus < 100 ||
    input.httpStatus > 599 || !(OPERATIONS as readonly string[]).includes(input.operation)) return null;
  return {
    request_id: input.requestId.toLowerCase(), http_status: input.httpStatus, operation: input.operation,
    ...(typeof input.jobId === "string" && UUID.test(input.jobId) ? { job_id: input.jobId.toLowerCase() } : {}),
    ...(typeof input.generationRequestId === "string" && UUID.test(input.generationRequestId)
      ? { generation_request_id: input.generationRequestId.toLowerCase() } : {}),
  };
}

async function send(request: Request, event: AnalyticsEvent, input: AnalyticsProperties, page?: AnalyticsPage): Promise<void> {
  const config = analyticsConfig();
  if (!config || request.signal.aborted || !analyticsAllowed(request, config.policyVersion) || !(EVENTS as readonly string[]).includes(event)) return;
  const properties = safeProperties(input);
  if (!properties) return;
  try {
    const response = await fetch(`${config.host}/i/v0/e`, {
      method: "POST", cache: "no-store", redirect: "error", credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: config.token, distinct_id: properties.request_id, event: `flashloop_${event}`,
        properties: { ...properties, environment: config.environment, $process_person_profile: false, $geoip_disable: true,
          ...(page ? { page } : {}) },
      }),
      signal: AbortSignal.any([AbortSignal.timeout(1500), request.signal]),
    });
    await response.body?.cancel();
  } catch {
    // Analytics must not change authorization, reservation or webhook outcomes.
    // Do not log the error: transport diagnostics can contain credentials or URLs.
  }
}

export function captureAnalytics(request: Request, event: AnalyticsEvent, properties: AnalyticsProperties): Promise<void> {
  return send(request, event, properties);
}

export function capturePageview(request: Request, page: AnalyticsPage): Promise<void> {
  if (!(ANALYTICS_PAGES as readonly string[]).includes(page)) return Promise.resolve();
  return send(request, "pageview", { requestId: randomUUID(), httpStatus: 204, operation: "pageview" }, page);
}
