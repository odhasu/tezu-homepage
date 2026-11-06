import { localPath } from "./local-path";

export const referenceUrl = "https://odhasu.github.io/flashloop-clone/blue/";
export function referenceLink(path = "") {
  return `${referenceUrl}${path}`;
}

export function authLink(signup = false) {
  return localPath(signup ? "/auth/signup/" : "/auth/");
}

/** Public editors never authorize a request; the account route checks the live session. */
export function studioLink(kind: "image" | "video") {
  return process.env.NEXT_PUBLIC_AUTH_ENABLED === "true"
    ? localPath(`/account?kind=${kind}`)
    : localPath(`/create/${kind}/`);
}

/** Keep supported product journeys inside this Flashloop app. */
export function productLink(href: string) {
  const path = href.startsWith(referenceUrl) ? href.slice(referenceUrl.length) : href;
  const pathname = path.split(/[?#]/)[0].replace(/^\//, "").replace(/\/$/, "");
  if (pathname === "create/image") return studioLink("image");
  if (pathname === "create/video") return studioLink("video");
  if (pathname === "pricing") return localPath("/pricing/");
  if (pathname === "auth") return authLink();
  if (pathname === "mcp") return localPath("/mcp/");
  if (pathname === "creators") return localPath("/creators/");
  if (pathname === "models" || pathname.startsWith("models/")) return localPath("/models/");
  return localPath(href);
}
