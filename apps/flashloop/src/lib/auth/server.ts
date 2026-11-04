import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { authConfig } from "./config";
import { AuthFailure, parseAuthContext, requireVerified, type AuthContext } from "./security";

export async function authClients(writable = true) {
  const config = authConfig();
  const store = await cookies();
  const client = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: config.origin.startsWith("https:"), sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => {
        if (!writable) return;
        for (const { name, value, options } of values) store.set(name, value, options);
      },
    },
  });
  const admin = createClient(config.supabaseUrl, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { config, client, admin };
}

export type AuthClients = Awaited<ReturnType<typeof authClients>>;

export async function authContext({ client }: AuthClients): Promise<AuthContext | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const result = await client.rpc("get_auth_context");
  if (result.error) throw new AuthFailure("Account verification unavailable.", 503);
  const context = parseAuthContext(result.data);
  return context?.user_id === user.id ? context : null;
}

/** Every protected handler calls this; redirects and client state never authorize actions. */
export async function requireProtectedSession(clients: AuthClients): Promise<AuthContext> {
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
  const result = await clients.admin.rpc("consume_auth_rate_limit", {
    p_key: hash, p_limit: limit, p_window_seconds: 600,
  });
  if (result.error) throw new AuthFailure("Authentication unavailable.", 503);
  if (result.data !== true) throw new AuthFailure("Too many attempts. Try again later.", 429);
}

export async function signupPermit(clients: AuthClients, email: string): Promise<string> {
  const permit = randomBytes(32).toString("hex");
  const result = await clients.admin.rpc("issue_signup_permit", {
    p_email: email, p_permit_hash: createHash("sha256").update(permit).digest("hex"),
  });
  if (result.error) throw new AuthFailure("Account creation unavailable.", 503);
  return permit;
}
