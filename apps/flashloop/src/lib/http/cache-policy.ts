/** No cache may retain responses containing authentication or account state. */
export const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
} as const;

/** Preserve Next.js RSC variants while adding defensive identity variation. */
export function privateResponse<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) response.headers.set(name, value);
  const vary = response.headers.get("Vary");
  if (vary !== "*") {
    const names = (vary ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    for (const name of ["Cookie", "Authorization"]) {
      if (!names.some((existing) => existing.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    response.headers.set("Vary", names.join(", "));
  }
  return response;
}

/** Every API is private by default, including future routes and framework errors. */
export function isPrivatePath(pathname: string, basePath = ""): boolean {
  const path = basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
    ? pathname.slice(basePath.length) || "/" : pathname;
  return ["/api", "/auth", "/account"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
