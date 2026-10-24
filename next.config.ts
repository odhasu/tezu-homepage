import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  ...(process.env.STATIC_EXPORT === "true" ? { output: "export", trailingSlash: true } : {}),
  turbopack: { root: __dirname },
  devIndicators: false,
};

export default nextConfig;
