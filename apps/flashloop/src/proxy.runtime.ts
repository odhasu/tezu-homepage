import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth/config";
import { localPath } from "@/lib/local-path";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";
import { authError } from "@/lib/auth/handlers";
import { boundedProviderFetch } from "@/lib/security/provider-fetch";
import { isPrivatePath, privateResponse } from "@/lib/http/cache-policy";

/** Refresh response cookies before rendering. Authorization remains in each page/API and RLS. */
export async function proxy(request: NextRequest) {
  try { requireEdgeOrigin(request); } catch (error) { return privateResponse(authError(error)); }
  let response = NextResponse.next({ request });
  const isPrivate = isPrivatePath(request.nextUrl.pathname, process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  if (isPrivate) privateResponse(response);
  const accountPath = localPath("/account");
  if (request.nextUrl.pathname !== accountPath && !request.nextUrl.pathname.startsWith(`${accountPath}/`)) return response;
  try {
    const settings = authConfig();
    const client = createServerClient(settings.supabaseUrl, settings.publishableKey, {
      global: { fetch: boundedProviderFetch },
      cookieOptions: { httpOnly: true, secure: settings.origin.startsWith("https:"), sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          for (const { name, value } of values) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          privateResponse(response);
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        },
      },
    });
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) {
      const redirect = NextResponse.redirect(new URL(localPath("/auth"), settings.origin));
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return privateResponse(redirect);
    }
    return privateResponse(response);
  } catch {
    return privateResponse(new NextResponse("Account access is unavailable.", { status: 503 }));
  }
}

export const config = { matcher: ["/:path*"] };
