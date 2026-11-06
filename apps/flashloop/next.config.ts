import type { NextConfig } from "next";
import { PRIVATE_RESPONSE_HEADERS } from "./src/lib/http/cache-policy";

const nextConfig: NextConfig = {
  // Runtime handlers never enter the GitHub Pages artifact.
  pageExtensions: process.env.STATIC_EXPORT === "true" ? ["tsx", "ts"] : ["runtime.ts", "runtime.tsx", "tsx", "ts"],
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  // A Pages build must never advertise absent account routes, even if a local
  // runtime env file enables authentication for a separate deployment.
  env: {
    NEXT_PUBLIC_AUTH_ENABLED: process.env.STATIC_EXPORT === "true" ? "false" : process.env.NEXT_PUBLIC_AUTH_ENABLED ?? "false",
  },
  ...(process.env.STATIC_EXPORT === "true" ? { output: "export", trailingSlash: true } : {}),
  turbopack: { root: __dirname },
  poweredByHeader: false,
  devIndicators: false,
  // GitHub Pages ignores runtime headers; this policy applies to the Next server.
  ...(process.env.STATIC_EXPORT === "true" ? {} : {
    async headers() {
      const privateHeaders = Object.entries(PRIVATE_RESPONSE_HEADERS).map(([key, value]) => ({ key, value }));
      return [
        ...["/api/:path*", "/auth/:path*", "/account/:path*"].map((source) => ({ source, headers: privateHeaders })),
        // Source filenames are not verified content hashes. Revalidate mutable
        // public assets; Next itself gives /_next/static content hashes immutable.
        { source: "/sites/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }] },
      ];
    },
  }),
};

export default nextConfig;
