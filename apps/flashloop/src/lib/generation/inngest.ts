import "server-only";

import { Inngest, NonRetriableError } from "inngest";
import { storageAdminClient } from "@/lib/storage/admin";
import { executeGenerationJob, generationRequestId, publishGenerationOutbox, requireGenerationJobs } from "./jobs";
import { newRequestId } from "@/lib/observability/correlation";
import { flushTelemetry, traceOperation } from "@/lib/observability/sentry";

/** Keep the existing app identity so storage schedules survive this extension. */
export function generationJobFunctions(existingClient?: Inngest) {
  requireGenerationJobs();
  const client = existingClient ?? new Inngest({
    id: "flashloop-private-storage",
    isDev: false,
    eventKey: process.env.INNGEST_EVENT_KEY,
    signingKey: process.env.INNGEST_SIGNING_KEY,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const publish = client.createFunction({
    id: "generation-dispatch-outbox",
    triggers: [{ cron: "* * * * *" }],
    concurrency: 1,
    retries: 4,
  }, async ({ step }) => step.run("publish-persisted-generation-requests", async () => {
    requireGenerationJobs();
    try {
      return await traceOperation("generation_outbox", { requestId: newRequestId() }, () =>
        publishGenerationOutbox(storageAdminClient(), (event) => client.send(event)));
    } finally { await flushTelemetry(); }
  }));
  const execute = client.createFunction({
    id: "generation-execute",
    triggers: [{ event: "flashloop/generation.requested" }],
    concurrency: [{ limit: 1 }, { limit: 1, key: "event.data.requestId" }],
    retries: 4,
  }, async ({ event, step }) => {
    let requestId: string;
    try { requestId = generationRequestId(event.data); }
    catch { throw new NonRetriableError("Invalid generation event."); }
    return step.run("dispatch-or-reconcile-persisted-generation", async () => {
      requireGenerationJobs();
      return executeGenerationJob(storageAdminClient(), requestId);
    });
  });
  return { client, functions: [publish, execute] };
}
