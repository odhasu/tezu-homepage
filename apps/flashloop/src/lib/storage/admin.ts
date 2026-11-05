import "server-only";
import { createClient } from "@supabase/supabase-js";
import { boundedProviderFetch } from "@/lib/security/provider-fetch";
import { AuthFailure } from "@/lib/auth/security";

/** Background worker client; no cookies, user tokens, or arbitrary endpoints. */
export function storageAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) {
    throw new AuthFailure("Storage database is not configured.", 503);
  }
  return createClient(url, secret, {
    global: { fetch: boundedProviderFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
