import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { privateResponse } from "@/lib/http/cache-policy";
import { localPath } from "@/lib/local-path";
import { requireEdgeOrigin, trustedClientIp } from "@/lib/security/edge-origin";
import { authClients, authContext, rateLimit, revokeSession, signupPermit, recheckSignupQuota, type AuthClients } from "./server";
import { AuthFailure, readAuthBody, readCredentials, requireSameOrigin, requireToken, verifyTurnstile } from "./security";

const GOOGLE_KIND_COOKIE = "flashloop_auth_kind";

function readCreationKind(value: unknown): "image" | "video" | undefined {
  return value === "image" || value === "video" ? value : undefined;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  let value: string | undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) continue;
    // Ambiguous or encoded values never select a destination or break a callback.
    if (value !== undefined) return undefined;
    value = item.slice(separator + 1).trim();
  }
  return value;
}

function clearGoogleKindCookie(response: NextResponse, secure: boolean): void {
  response.cookies.set(GOOGLE_KIND_COOKIE, "", {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0,
  });
}

function requireSafeAuthNavigation(request: Request, origin: string): void {
  const requestOrigin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((requestOrigin && requestOrigin !== origin) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
    throw new AuthFailure("Request origin rejected.", 403);
  }
}

async function startGoogleAuth(request: Request, clients: AuthClients) {
  if (process.env.GOOGLE_AUTH_ENABLED !== "true") throw new AuthFailure("Google sign-in is not configured yet.", 503);
  requireSafeAuthNavigation(request, clients.config.origin);
  await rateLimit(clients, `google:ip:${trustedClientIp(request)}`, 10);
  const requestUrl = new URL(request.url);
  const kinds = requestUrl.searchParams.getAll("kind");
  const kind = kinds.length === 1 ? readCreationKind(kinds[0]) : undefined;
  const redirectTo = `${clients.config.origin}${localPath("/api/auth/callback")}`;
  const result = await clients.client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (result.error || !result.data.url) throw new AuthFailure("Google sign-in is not configured yet.", 503);
  const authorization = new URL(result.data.url);
  const supabase = new URL(clients.config.supabaseUrl);
  const providers = authorization.searchParams.getAll("provider");
  const redirects = authorization.searchParams.getAll("redirect_to");
  if (authorization.origin !== supabase.origin || authorization.pathname !== "/auth/v1/authorize" ||
    authorization.username || authorization.password || authorization.hash ||
    providers.length !== 1 || providers[0] !== "google" || redirects.length !== 1 || redirects[0] !== redirectTo) {
    throw new AuthFailure("Google sign-in is not configured yet.", 503);
  }
  const response = NextResponse.redirect(authorization, 303);
  if (kind) {
    response.cookies.set(GOOGLE_KIND_COOKIE, kind, {
      httpOnly: true, secure: clients.config.origin.startsWith("https:"), sameSite: "lax", path: "/", maxAge: 600,
    });
  } else clearGoogleKindCookie(response, clients.config.origin.startsWith("https:"));
  response.headers.set("Referrer-Policy", "no-referrer");
  return privateResponse(response);
}

function callbackRecovery(clients: AuthClients, kind: "image" | "video" | undefined) {
  const path = `/auth?authError=callback${kind ? `&kind=${kind}` : ""}`;
  const response = NextResponse.redirect(`${clients.config.origin}${localPath(path)}`, 303);
  clearGoogleKindCookie(response, clients.config.origin.startsWith("https:"));
  response.headers.set("Referrer-Policy", "no-referrer");
  return privateResponse(response);
}

export function authJson(value: unknown, status = 200) {
  return privateResponse(NextResponse.json(value, { status }));
}

export function authError(error: unknown) {
  const response = authJson({ error: error instanceof AuthFailure ? error.message : "Authentication unavailable. Try again." },
    error instanceof AuthFailure ? error.status : 503);
  if (error instanceof AuthFailure && (error.status === 429 || error.status === 503) && error.retryAfter) {
    response.headers.set("Retry-After", String(error.retryAfter));
  }
  return response;
}

async function verifySession(request: Request, clients: AuthClients) {
  let context: Awaited<ReturnType<typeof authContext>> = null;
  let attempt: string | undefined;
  try {
    context = await authContext(clients);
    if (!context) throw new AuthFailure("Sign in to continue.", 401);
    const started = await clients.client.rpc("begin_session_verification");
    if (started.error || typeof started.data !== "string") throw new AuthFailure("Verification unavailable. Sign in again.");
    attempt = started.data;
    await rateLimit(clients, `verify:account:${context.user_id}`);
    const body = await readAuthBody(request);
    await verifyTurnstile(body.token, "verify_session", clients.config);
    const finished = await clients.admin.rpc("finish_session_verification", {
      p_user_id: context.user_id, p_session_id: context.session_id, p_attempt_id: attempt, p_success: true,
    });
    if (finished.error || finished.data !== true) throw new AuthFailure("Verification failed. Sign in again.");
    return authJson({ ok: true, verified: true });
  } catch (error) {
    try {
      if (attempt && context) await clients.admin.rpc("finish_session_verification", {
        p_user_id: context.user_id, p_session_id: context.session_id, p_attempt_id: attempt, p_success: false,
      });
    } finally {
      await revokeSession(clients);
    }
    throw error;
  }
}

export async function handleAuthPost(request: Request, operation: string) {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients();
    requireSameOrigin(request, clients.config.origin);
    if (operation === "verify") return await verifySession(request, clients);
    if (operation === "signout") {
      await revokeSession(clients);
      return authJson({ ok: true });
    }
    if (operation !== "signup" && operation !== "signin") return authJson({ error: "Not found." }, 404);
    const body = await readAuthBody(request);
    const credentials = readCredentials(body);
    const captchaToken = requireToken(body.captchaToken);
    if (captchaToken === body.token) throw new AuthFailure("Complete both security checks again.");
    const ip = trustedClientIp(request);
    await rateLimit(clients, `${operation}:ip:${ip}`, 20);
    await rateLimit(clients, `${operation}:email:${credentials.email}`);
    await verifyTurnstile(body.token, operation, clients.config);
    if (operation === "signup") {
      const permit = await signupPermit(clients, credentials.email, ip);
      const result = await clients.client.auth.signUp({ ...credentials, options: {
        captchaToken,
        emailRedirectTo: `${clients.config.origin}${localPath("/api/auth/callback")}`,
        data: { signup_permit: permit },
      } });
      if (result.error) {
        await recheckSignupQuota(clients, ip);
        throw new AuthFailure("Account could not be created. Check details and try again.", 400);
      }
      // Confirm-email is required operationally; an unexpected session cannot grant access.
      if (result.data.session) {
        await revokeSession(clients);
        throw new AuthFailure("Email confirmation must be enabled.", 503);
      }
      return authJson({ ok: true, confirmationRequired: true });
    }
    const result = await clients.client.auth.signInWithPassword({ ...credentials, options: { captchaToken } });
    if (result.error || !result.data.user.email_confirmed_at) {
      if (result.data.session) await revokeSession(clients);
      throw new AuthFailure("Sign-in failed. Confirm your email and check your details.", 401);
    }
    return authJson({ ok: true, next: localPath("/auth/verify") });
  } catch (error) { return authError(error); }
}

export async function handleAuthGet(request: Request, operation: string) {
  try {
    requireEdgeOrigin(request);
    const clients = await authClients();
    if (operation === "session") {
      const context = await authContext(clients);
      return authJson({ authenticated: Boolean(context), verified: context?.verification === "verified" && context.email_confirmed,
        emailConfirmed: context?.email_confirmed ?? false,
        ...(context?.verification === "verified" && context.email_confirmed ? {
          credits: context.credits,
          // An opaque UI binding, never an authentication capability or analytics identity.
          sessionScope: createHash("sha256").update(`${context.user_id}:${context.session_id}`).digest("hex"),
        } : {}),
      });
    }
    if (operation === "callback") {
      const url = new URL(request.url);
      const kind = readCreationKind(readCookie(request.headers.get("cookie"), GOOGLE_KIND_COOKIE));
      const codes = url.searchParams.getAll("code");
      const code = codes.length === 1 ? codes[0] : undefined;
      if (url.searchParams.has("error") || !code || code.length > 4096 || /[\u0000-\u0020\u007f]/.test(code)) {
        return callbackRecovery(clients, kind);
      }
      // Both email and Google use the verifier in this browser's HttpOnly cookie.
      const result = await clients.client.auth.exchangeCodeForSession(code).catch(() => null);
      if (!result) return callbackRecovery(clients, kind);
      if (result.error || !result.data.user?.email_confirmed_at) {
        if (result.data.session) await revokeSession(clients);
        return callbackRecovery(clients, kind);
      }
      const response = NextResponse.redirect(`${clients.config.origin}${localPath(kind ? `/auth/verify?kind=${kind}` : "/auth/verify")}`, 303);
      clearGoogleKindCookie(response, clients.config.origin.startsWith("https:"));
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return privateResponse(response);
    }
    if (operation === "google") return await startGoogleAuth(request, clients);
    return authJson({ error: "Not found." }, 404);
  } catch (error) { return authError(error); }
}
