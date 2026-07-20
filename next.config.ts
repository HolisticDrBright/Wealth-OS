import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['100.77.250.8'],
  // Pin the workspace root so a stray lockfile in a parent directory (e.g. the
  // user's home folder) can never hijack module resolution.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
