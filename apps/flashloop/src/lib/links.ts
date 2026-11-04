import { localPath } from "./local-path";

export const referenceUrl = "https://odhasu.github.io/flashloop-clone/blue/";
export function referenceLink(path = "") {
  return `${referenceUrl}${path}`;
}

export function authLink(signup = false) {
  return process.env.NEXT_PUBLIC_AUTH_ENABLED === "true"
    ? localPath(signup ? "/auth/signup" : "/auth")
    : referenceLink("auth/");
}
