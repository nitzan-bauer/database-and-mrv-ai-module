import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a server-only dependency; keep it external to the bundle.
  serverExternalPackages: ["pg"],
  // Default is 1 MB, which silently rejects any attached file over ~750 KB (base64 adds a third). Vercel caps request
  // bodies at 4.5 MB, so this is the most a server action can receive there.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
