import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` is a server-only dependency; keep it external to the bundle.
  // @ffmpeg-installer/ffmpeg ships a native binary resolved via its own
  // __dirname-relative path — bundling it risks losing that binary file
  // or breaking the path; kept external so Node resolves it from
  // node_modules at runtime and Vercel's file tracing picks up the binary
  // as a real asset alongside the function.
  serverExternalPackages: ["pg", "@ffmpeg-installer/ffmpeg"],
};

export default nextConfig;
