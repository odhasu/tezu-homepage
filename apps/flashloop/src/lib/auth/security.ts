export class AuthFailure extends Error {
  status: number;
  retryAfter?: number;

  constructor(message: string, status = 403, retryAfter?: number) {
    super(message);
    this.status = status;
    if (typeof retryAfter === "number" && Number.isSafeInteger(retryAfter) && retryAfter > 0 && retryAfter <= 345600) {
      this.retryAfter = retryAfter;
    }
  }
}

export type TurnstileConfig = { secret: string; hostname: string };

export function requireToken(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) {
    throw new AuthFailure("Complete the security check again.");
  }
  return value;
}

/** Siteverify owns expiry and single-use enforcement. Never reuse an idempotency key. */
export async function verifyTurnstile(
  token: unknown,
  action: "signup" | "signin" | "verify_session",
  config: TurnstileConfig,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<void> {
  const responseToken = requireToken(token);
  if (!config.secret || !config.hostname) throw new AuthFailure("Authentication unavailable.", 503);
  try {
    const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: config.secret, response: responseToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const result: unknown = await response.json();
    if (!response.ok || !result || typeof result !== "object") throw new Error("Invalid response");
    const data = result as Record<string, unknown>;
    const timestamp = typeof data.challenge_ts === "string" ? Date.parse(data.challenge_ts) : NaN;
    if (data.success !== true || data.hostname !== config.hostname || data.action !== action ||
      !Number.isFinite(timestamp) || now - timestamp >= 300_000 || timestamp > now + 30_000) {
      throw new Error("Challenge rejected");
    }
  } catch {
    throw new AuthFailure("Security verification failed. Start again.");
  }
}

/** Origin is deployment configuration, never derived from attacker-controlled forwarding headers. */
export function requireSameOrigin(request: Request, origin: string): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== origin ||
    (fetchSite !== null && fetchSite !== "same-origin") ||
    request.headers.get("x-requested-with") !== "flashloop" ||
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new AuthFailure("Request origin rejected.");
  }
}

export async function readAuthBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new AuthFailure("Invalid request.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 12_000) {
        await reader.cancel();
        throw new AuthFailure("Request too large.", 413);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AuthFailure) throw error;
    throw new AuthFailure("Invalid request.", 400);
  } finally {
    reader.releaseLock();
  }
}

export function readCredentials(body: Record<string, unknown>): { email: string; password: string } {
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw new AuthFailure("Enter an email and password.", 400);
  }
  const email = body.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    body.password.length < 12 || body.password.length > 128) {
    throw new AuthFailure("Use a valid email and a password between 12 and 128 characters.", 400);
  }
  return { email, password: body.password };
}

export type AuthContext = {
  user_id: string;
  session_id: string;
  email_confirmed: boolean;
  verification: "pending" | "verifying" | "verified" | "failed";
  credits: number;
};

export function parseAuthContext(value: unknown): AuthContext | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.user_id !== "string" || typeof data.session_id !== "string" ||
    typeof data.email_confirmed !== "boolean" || typeof data.credits !== "number" ||
    !Number.isSafeInteger(data.credits) || data.credits < 0 ||
    !["pending", "verifying", "verified", "failed"].includes(String(data.verification))) return null;
  return data as AuthContext;
}

export function requireVerified(context: AuthContext | null): AuthContext {
  if (!context) throw new AuthFailure("Sign in to continue.", 401);
  if (!context.email_confirmed || context.verification !== "verified") {
    throw new AuthFailure("Complete account verification first.");
  }
  return context;
}
