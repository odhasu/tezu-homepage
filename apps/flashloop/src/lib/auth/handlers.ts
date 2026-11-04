import "server-only";
import { NextResponse } from "next/server";
import { localPath } from "@/lib/local-path";
import { authClients, authContext, rateLimit, revokeSession, signupPermit, type AuthClients } from "./server";
import { AuthFailure, readAuthBody, readCredentials, requireSameOrigin, requireToken, verifyTurnstile } from "./security";

export function authJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store", "Pragma": "no-cache" } });
}

export function authError(error: unknown) {
  return authJson({ error: error instanceof AuthFailure ? error.message : "Authentication unavailable. Try again." },
    error instanceof AuthFailure ? error.status : 503);
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
    await rateLimit(clients, `verify:${context.user_id}:${context.session_id}`);
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
    // Vercel overwrites this header. Do not trust generic X-Forwarded-For from direct clients.
    const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") : "local";
    await rateLimit(clients, `${operation}:ip:${ip ?? "unknown"}`, 20);
    await rateLimit(clients, `${operation}:email:${credentials.email}`);
    await verifyTurnstile(body.token, operation, clients.config);
    if (operation === "signup") {
      const permit = await signupPermit(clients, credentials.email);
      const result = await clients.client.auth.signUp({ ...credentials, options: {
        captchaToken,
        emailRedirectTo: `${clients.config.origin}${localPath("/api/auth/callback")}`,
        data: { signup_permit: permit },
      } });
      if (result.error) throw new AuthFailure("Account could not be created. Check details and try again.", 400);
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
    const clients = await authClients();
    if (operation === "session") {
      const context = await authContext(clients);
      return authJson({ authenticated: Boolean(context), verified: context?.verification === "verified" && context.email_confirmed,
        emailConfirmed: context?.email_confirmed ?? false,
        ...(context?.verification === "verified" ? { credits: context.credits } : {}),
      });
    }
    if (operation === "callback") {
      const url = new URL(request.url);
      const code = url.searchParams.get("code");
      if (!code || code.length > 4096) throw new AuthFailure("Confirmation link is invalid.", 400);
      // PKCE binds the emailed callback to the browser that initiated signup. No open redirects.
      const result = await clients.client.auth.exchangeCodeForSession(code);
      if (result.error || !result.data.user?.email_confirmed_at) {
        if (result.data.session) await revokeSession(clients);
        throw new AuthFailure("Confirmation failed. Sign in again.");
      }
      const response = NextResponse.redirect(`${clients.config.origin}${localPath("/auth/verify")}`, 303);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    return authJson({ error: "Not found." }, 404);
  } catch (error) { return authError(error); }
}
