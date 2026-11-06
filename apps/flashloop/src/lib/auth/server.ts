import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { boundedProviderFetch } from "@/lib/security/provider-fetch";
import { authConfig } from "./config";
import { AuthFailure, parseAuthContext, requireVerified, type AuthContext } from "./security";

const userDataClients = new WeakSet<SupabaseClient>();

/** Only the publishable-key cookie factory can issue a client for user data. */
export function assertUserDataClient(client: SupabaseClient): void {
  if (!userDataClients.has(client)) throw new AuthFailure("User-scoped database client required.", 503);
}

export async function authUserClient(writable = true) {
  const config = authConfig();
  const store = await cookies();
  const client = createServerClient(config.supabaseUrl, config.publishableKey, {
    global: { fetch: boundedProviderFetch },
    cookieOptions: { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        if (!writable) return;
        for (const { name, value, options } of values) {
          // The SDK's session cookie lifetime must not become a verifier lifetime.
          const verifier = /-code-verifier(?:\.\d+)?$/.test(name);
          store.set(name, value, verifier && options.maxAge !== 0 ? { ...options, maxAge: 600 } : options);
        }
      },
    },
  });
  userDataClients.add(client);
  return { config, client };
}

export async function authClients(writable = true) {
  const { config, client } = await authUserClient(writable);
  const admin = createClient(config.supabaseUrl, config.secretKey, {
    global: { fetch: boundedProviderFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { config, client, admin };
}

export type AuthClients = Awaited<ReturnType<typeof authClients>>;

export async function authContext({ client }: Pick<AuthClients, "client">): Promise<AuthContext | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const result = await client.rpc("get_auth_context");
  if (result.error) throw new AuthFailure("Account verification unavailable.", 503);
  const context = parseAuthContext(result.data);
  return context?.user_id === user.id ? context : null;
}

/** Every protected handler calls this; redirects and client state never authorize actions. */
export async function requireProtectedSession(clients: Pick<AuthClients, "client">): Promise<AuthContext> {
  return requireVerified(await authContext(clients));
}

export async function revokeSession({ client }: AuthClients): Promise<void> {
  // Persist denial before the network logout. Existing JWTs must fail live RLS checks.
  try { await client.rpc("revoke_current_session"); } finally {
    let logoutFailed = false;
    try {
      const result = await client.auth.signOut({ scope: "local" });
      logoutFailed = Boolean(result.error);
    } catch {
      logoutFailed = true;
    } finally {
      const store = await cookies();
      const settings = authConfig();
      const projectHost = new URL(settings.supabaseUrl).hostname.split(".")[0];
      for (const cookie of store.getAll()) {
        if (cookie.name.startsWith(`sb-${projectHost}-auth-token`)) {
          store.set(cookie.name, "", { maxAge: 0, path: "/", httpOnly: true, secure: settings.origin.startsWith("https:"), sameSite: "lax" });
        }
      }
    }
    if (logoutFailed) throw new AuthFailure("Session access denied. Sign-out could not finish; try again.", 503);
  }
}

export async function rateLimit(clients: AuthClients, key: string, limit = 5): Promise<void> {
  const hash = createHash("sha256").update(key).digest("hex");
  try {
    const result = await clients.admin.rpc("consume_auth_rate_limit", {
      p_key: hash, p_limit: limit, p_window_seconds: 600,
    }).abortSignal(AbortSignal.timeout(8000));
    if (result.error) throw new AuthFailure("Authentication unavailable.", 503, 600);
    // The existing atomic RPC returns only a boolean. A full window is a safe
    // retry bound even when this request arrives partway through that window.
    if (result.data !== true) throw new AuthFailure("Too many attempts. Try again later.", 429, 600);
  } catch (error) {
    if (error instanceof AuthFailure) throw error;
    throw new AuthFailure("Authentication unavailable.", 503, 600);
  }
}

function signupIpKey(trustedIp: string): string {
  const ipSecret = process.env.SIGNUP_IP_HASH_SECRET;
  if (!ipSecret || ipSecret.length < 32 || ipSecret.length > 256 || ipSecret.trim() !== ipSecret) {
    throw new AuthFailure("Signup protection is not configured.", 503);
  }
  return createHmac("sha256", ipSecret).update(trustedIp).digest("hex");
}

function requireSignupQuota(status: unknown): void {
  if (!status || typeof status !== "object" || Array.isArray(status)) throw new AuthFailure("Account creation unavailable.", 503);
  const quota = status as Record<string, unknown>;
  if (quota.allowed === false && typeof quota.retry_after_seconds === "number" &&
    Number.isSafeInteger(quota.retry_after_seconds) && quota.retry_after_seconds > 0 && quota.retry_after_seconds <= 345600) {
    throw new AuthFailure("This network has reached its signup limit. Try again later.", 429, quota.retry_after_seconds);
  }
  if (quota.allowed !== true) throw new AuthFailure("Account creation unavailable.", 503);
}

/** A failure-only recheck maps a racing database quota denial without parsing provider errors. */
export async function recheckSignupQuota(clients: AuthClients, trustedIp: string): Promise<void> {
  const result = await clients.admin.rpc("get_signup_ip_quota", { p_ip_key_hash: signupIpKey(trustedIp) });
  if (result.error) throw new AuthFailure("Account creation unavailable.", 503, 600);
  requireSignupQuota(result.data);
}

export async function signupPermit(clients: AuthClients, email: string, trustedIp: string): Promise<string> {
  const ipKey = signupIpKey(trustedIp);
  const permit = randomBytes(32).toString("hex");
  const result = await clients.admin.rpc("issue_signup_permit_for_ip", {
    p_email: email,
    p_permit_hash: createHash("sha256").update(permit).digest("hex"),
    p_ip_key_hash: ipKey,
  });
  if (result.error) throw new AuthFailure("Account creation unavailable.", 503);
  requireSignupQuota(result.data);
  return permit;
}
