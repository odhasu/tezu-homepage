import "server-only";
import { AuthFailure } from "./security";

export function authConfig() {
  const originValue = process.env.AUTH_ORIGIN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const secret = process.env.TURNSTILE_SECRET;
  const hostname = process.env.TURNSTILE_HOSTNAME;
  if (process.env.AUTH_ENABLED !== "true" || process.env.AUTH_PROVIDER_CONFIGURED !== "true" ||
    !originValue || !supabaseUrl || !publishableKey || !secretKey || !secret || !hostname) {
    throw new AuthFailure("Authentication is not configured yet.", 503);
  }
  try {
    const origin = new URL(originValue);
    const database = new URL(supabaseUrl);
    const local = process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1"].includes(origin.hostname);
    if (origin.origin !== originValue || origin.hostname !== hostname ||
      (origin.protocol !== "https:" && !local) || database.protocol !== "https:" ||
      database.pathname !== "/" || database.search || database.hash || database.username || database.password ||
      (!local && ["localhost", "127.0.0.1"].includes(hostname)) ||
      secret === "1x0000000000000000000000000000000AA") throw new Error("Invalid configuration");
    return { origin: origin.origin, supabaseUrl, publishableKey, secretKey, secret, hostname };
  } catch {
    throw new AuthFailure("Authentication configuration is invalid.", 503);
  }
}
