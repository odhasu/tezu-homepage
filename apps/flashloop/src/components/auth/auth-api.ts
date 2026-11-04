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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
