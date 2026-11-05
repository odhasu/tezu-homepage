import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.STATIC_EXPORT === "true") return;
  const { initializeSentry } = await import("./lib/observability/sentry");
  initializeSentry();
}

export const onRequestError: Instrumentation.onRequestError = async () => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.STATIC_EXPORT === "true") return;
  const [{ reportFailure, flushTelemetry }, { newRequestId }] = await Promise.all([
    import("./lib/observability/sentry"), import("./lib/observability/correlation"),
  ]);
  // Next's error, path and headers can contain credentials or personal content.
  reportFailure("framework", { requestId: newRequestId() });
  await flushTelemetry();
};
