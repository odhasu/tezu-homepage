import "server-only";

import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { billingConfig, BillingConfigurationError } from "./config";
import { AuthFailure } from "@/lib/auth/security";

const AUTH_URL = "https://api.whop.com/oauth/authorize";
const TOKEN_URL = "https://api.whop.com/oauth/token";
const USERINFO_URL = "https://api.whop.com/oauth/userinfo";
const REVOKE_URL = "https://api.whop.com/oauth/revoke";
const SAFE = /^[A-Za-z0-9._~-]{22,256}$/;

export interface WhopOAuthStart { state: string; codeVerifier: string; nonce: string; authorizationUrl: string; }
export interface WhopOAuthUser { sub: string; }
export interface WhopOAuthState {
  userId: string;
  sessionId: string;
  state: string;
  codeVerifier: string;
  nonce: string;
  expiresAt: number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATE_AAD = Buffer.from("flashloop.whop.oauth.v1");
function oauthStateKey(): Buffer {
  const secret = process.env.WHOP_OAUTH_STATE_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32 || secret.length > 4096 || secret.trim() !== secret) throw new BillingConfigurationError("Whop sign-in state protection is not configured.");
  return createHash("sha256").update(secret).digest();
}
function validState(value: WhopOAuthState, now: number): boolean {
  return UUID.test(value.userId) && UUID.test(value.sessionId) && SAFE.test(value.state) && SAFE.test(value.codeVerifier) &&
    SAFE.test(value.nonce) && Number.isSafeInteger(value.expiresAt) && value.expiresAt > now && value.expiresAt <= now + 600_000;
}
export function sealWhopOAuthState(input: Omit<WhopOAuthState, "expiresAt"> & { now?: number }): string {
  const now = input.now ?? Date.now();
  const state: WhopOAuthState = { userId: input.userId, sessionId: input.sessionId, state: input.state, codeVerifier: input.codeVerifier, nonce: input.nonce, expiresAt: now + 600_000 };
  if (!validState(state, now)) throw new AuthFailure("Whop sign-in state is invalid.", 400);
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", oauthStateKey(), iv); cipher.setAAD(STATE_AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}
export function unsealWhopOAuthState(input: { token: string; userId: string; sessionId: string; now?: number }): WhopOAuthState {
  try {
    if (input.token.length > 4096) throw new Error();
    const parts = input.token.split("."); if (parts.length !== 4 || parts[0] !== "v1" || parts.slice(1).some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const [iv, ciphertext, tag] = parts.slice(1).map((part) => Buffer.from(part, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", oauthStateKey(), iv); decipher.setAAD(STATE_AAD); decipher.setAuthTag(tag);
    const state = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as WhopOAuthState;
    if (!validState(state, input.now ?? Date.now()) || state.userId !== input.userId || state.sessionId !== input.sessionId) throw new Error();
    return state;
  } catch (error) {
    if (error instanceof BillingConfigurationError) throw error;
    throw new AuthFailure("Whop sign-in state is invalid or expired.", 400);
  }
}
function sameState(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}
async function oauthFetch(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) { await response.body?.cancel(); throw new AuthFailure("Whop sign-in request failed.", 503); }
  const reader = response.body?.getReader(); if (!reader) throw new AuthFailure("Whop sign-in response unavailable.", 503);
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 16_384) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
    return jsonObject(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch { throw new AuthFailure("Whop sign-in response unavailable.", 503); }
  finally { reader.releaseLock(); }
}

function base64url(bytes: Uint8Array): string { return Buffer.from(bytes).toString("base64url"); }
function randomValue(bytes = 32): string { return base64url(randomBytes(bytes)); }
function challenge(verifier: string): string { return base64url(createHash("sha256").update(verifier).digest()); }
function redirect(config = billingConfig("oauth")): string {
  const value = process.env.WHOP_OAUTH_REDIRECT_URI?.trim();
  if (!value) throw new BillingConfigurationError("Whop sign-in is not configured yet.");
  try { const url = new URL(value); if (url.origin !== config.origin || url.protocol !== "https:" || url.pathname !== "/api/billing/oauth/callback" || url.search || url.hash || url.username || url.password) throw new Error(); return url.toString(); } catch { throw new BillingConfigurationError("Whop sign-in redirect is invalid."); }
}
function jsonObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid response"); return value as Record<string, unknown>; }

export function beginWhopOAuth(): WhopOAuthStart {
  const config = billingConfig("oauth"); if (config.environment === "sandbox") throw new BillingConfigurationError("Whop OAuth sandbox support is unverified; account linking is disabled in staging."); const clientId = process.env.WHOP_OAUTH_CLIENT_ID?.trim(); if (!clientId) throw new BillingConfigurationError("Whop sign-in is not configured yet.");
  const codeVerifier = randomValue(); const state = randomValue(24); const nonce = randomValue(24); const uri = redirect(config);
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: uri, scope: "openid", state, nonce, code_challenge: challenge(codeVerifier), code_challenge_method: "S256", company_id: config.accountId });
  return { state, codeVerifier, nonce, authorizationUrl: `${AUTH_URL}?${params.toString()}` };
}

export async function exchangeWhopOAuthCode(input: { code: string; codeVerifier: string; expectedState: string; state: string; nonce?: string; fetcher?: typeof fetch }): Promise<WhopOAuthUser> {
  if (!SAFE.test(input.code) || !SAFE.test(input.codeVerifier) || !sameState(input.state, input.expectedState)) throw new Error("Invalid Whop sign-in callback.");
  const config = billingConfig("oauth"); if (config.environment === "sandbox") throw new BillingConfigurationError("Whop OAuth sandbox support is unverified; account linking is disabled in staging."); const clientId = process.env.WHOP_OAUTH_CLIENT_ID?.trim(); if (!clientId) throw new BillingConfigurationError("Whop sign-in is not configured yet.");
  const tokens = await oauthFetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code: input.code, redirect_uri: redirect(config), client_id: clientId, code_verifier: input.codeVerifier }) }, input.fetcher);
  const accessToken = typeof tokens.access_token === "string" && tokens.access_token.length <= 8192 ? tokens.access_token : null;
  if (!accessToken || (tokens.token_type !== "Bearer" && tokens.token_type !== "bearer")) throw new AuthFailure("Whop sign-in exchange failed.", 503);
  try {
    const user = await oauthFetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } }, input.fetcher);
    const sub = typeof user.sub === "string" && /^user_[A-Za-z0-9]{1,128}$/.test(user.sub) ? user.sub : null;
    if (!sub) throw new AuthFailure("Whop sign-in identity failed.", 503);
    return { sub };
  } finally {
    const refresh = typeof tokens.refresh_token === "string" && tokens.refresh_token.length <= 8192 ? tokens.refresh_token : null;
    if (refresh) {
      const fetcher = input.fetcher ?? fetch;
      await fetcher(REVOKE_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: refresh, client_id: clientId }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000) }).then(async (response) => { await response.body?.cancel(); if (!response.ok) throw new Error(); }).catch(() => { throw new AuthFailure("Whop token cleanup failed. Try linking again.", 503); });
    }
  }
}
