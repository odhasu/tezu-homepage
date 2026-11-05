import { randomUUID } from "node:crypto";

export type Correlation = {
  requestId?: string;
  jobId?: string;
  generationRequestId?: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Generate at the trusted server boundary; never reuse a caller's request header. */
export function newRequestId(): string {
  return randomUUID();
}

/** Shape validation is defense in depth, not evidence that a caller owns an ID. */
export function safeCorrelation(input: unknown = {}): Correlation {
  const result: Correlation = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  const source = input as Record<string, unknown>;
  for (const key of ["requestId", "jobId", "generationRequestId"] as const) {
    const value = source[key];
    if (typeof value === "string" && uuid.test(value)) result[key] = value.toLowerCase();
  }
  return result;
}
