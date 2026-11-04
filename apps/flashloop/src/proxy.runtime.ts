import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/lib/auth/config";
import { localPath } from "@/lib/local-path";

/** Refresh response cookies before rendering. Authorization remains in each page/API and RLS. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  try {
    const settings = authConfig();
    const client = createServerClient(settings.supabaseUrl, settings.publishableKey, {
      cookieOptions: { httpOnly: true, secure: settings.origin.startsWith("https:"), sameSite: "lax", path: "/" },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (values) => {
          for (const { name, value } of values) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        },
      },
    });
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) {
      const redirect = NextResponse.redirect(new URL(localPath("/auth"), settings.origin));
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      redirect.headers.set("Cache-Control", "private, no-store");
      return redirect;
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return new NextResponse("Account access is unavailable.", { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export const config = { matcher: ["/account/:path*"] };
