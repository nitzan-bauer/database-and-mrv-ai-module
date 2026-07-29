import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a server-only dependency; keep it external to the bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
