import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next.js 15.5 moved typedRoutes out of `experimental`.
  typedRoutes: true,
  // A stray parent pnpm-lock.yaml makes Next guess the workspace root; pin it to this app.
  outputFileTracingRoot: path.join(import.meta.dirname),
};

export default nextConfig;
