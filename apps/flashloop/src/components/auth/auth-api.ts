import { localPath } from "@/lib/local-path";

export type AuthSession = {
  authenticated: boolean;
  verified: boolean;
  emailConfirmed?: boolean;
  credits?: number;
};

type AuthReply = {
  ok?: boolean;
  confirmationRequired?: boolean;
};

export class AuthRetryError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message);
    this.name = "AuthRetryError";
  }
}

export class AuthRateLimitError extends AuthRetryError {
  readonly name = "AuthRateLimitError";
}

export function readRetryAfter(value: string | null, now = Date.now()): number {
  if (value && /^\d+$/.test(value.trim())) {
    const seconds = Number(value.trim());
    if (Number.isSafeInteger(seconds)) return Math.max(1, seconds);
  }
  if (value && /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    const seconds = Math.ceil((Date.parse(value) - now) / 1000);
    if (Number.isSafeInteger(seconds) && seconds > 0) return seconds;
  }
  // Cloudflare's Free rate rule can return HTML without a Retry-After header.
  return 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryFailure(response: Response, data: unknown): AuthRetryError | null {
  if (response.status === 429) {
    return new AuthRateLimitError(
      "Too many attempts. Please wait before trying again.",
      readRetryAfter(response.headers.get("retry-after")),
    );
  }
  if (response.status === 503 && response.headers.has("retry-after")) {
    const message = isRecord(data) && typeof data.error === "string" && data.error.trim() && data.error.length <= 300
      ? data.error
      : "Account access is temporarily unavailable. Please try again later.";
    return new AuthRetryError(message, readRetryAfter(response.headers.get("retry-after")));
  }
  return null;
}

export async function postAuth(
  action: "signup" | "signin" | "verify" | "signout",
  body: Record<string, string>,
): Promise<AuthReply> {
  const response = await fetch(localPath(`/api/auth/${action}`), {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "flashloop",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data: unknown = await response.json().catch(() => null);
  const retryError = retryFailure(response, data);
  if (retryError) throw retryError;
  if (!response.ok || !isRecord(data) || data.ok !== true) {
    const message = isRecord(data) && typeof data.error === "string"
      ? data.error
      : "Account access could not finish. Please try again.";
    throw new Error(message);
  }
  return {
    ok: true,
    confirmationRequired: data.confirmationRequired === true,
  };
}

export async function getAuthSession(signal?: AbortSignal): Promise<AuthSession> {
  const response = await fetch(localPath("/api/auth/session"), {
    credentials: "same-origin",
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(15000),
  });
  const data: unknown = await response.json().catch(() => null);
  const retryError = retryFailure(response, data);
  if (retryError) throw retryError;
  if (
    !response.ok || !isRecord(data) ||
    typeof data.authenticated !== "boolean" ||
    typeof data.verified !== "boolean"
  ) {
    throw new Error("Your session could not be checked. Please sign in again.");
  }
  return {
    authenticated: data.authenticated,
    verified: data.verified,
    emailConfirmed: data.emailConfirmed === true,
    credits: typeof data.credits === "number" && Number.isSafeInteger(data.credits) && data.credits >= 0
      ? data.credits
      : undefined,
  };
}

export function authErrorMessage(error: unknown): string {
  return error instanceof Error && error.name !== "TimeoutError" && error.name !== "AbortError"
    ? error.message
    : "Connection interrupted. Please try again with a fresh security check.";
}
