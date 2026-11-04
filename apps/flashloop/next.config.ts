import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Runtime handlers never enter the GitHub Pages artifact.
  pageExtensions: process.env.STATIC_EXPORT === "true" ? ["tsx", "ts"] : ["runtime.ts", "runtime.tsx", "tsx", "ts"],
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  ...(process.env.STATIC_EXPORT === "true" ? { output: "export", trailingSlash: true } : {}),
  turbopack: { root: __dirname },
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
