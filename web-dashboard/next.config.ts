import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 6: emit a fully static `out/` export that the Rust binary embeds
  // via rust-embed. No Node server runs in production; the dashboard talks to
  // the Rust backend through same-origin `/api` with a JWT Bearer token.
  output: 'export',
  images: { unoptimized: true },
  allowedDevOrigins: ['51.75.131.6'],
};

export default nextConfig;
