import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Only load the icons/utilities actually imported — smaller client
    // bundles, faster first paint and route transitions.
    optimizePackageImports: ["lucide-react", "date-fns", "@base-ui/react"],
    // Keep prefetched route payloads briefly so revisiting a page is instant
    // instead of re-rendering on the server every click. Server renders are
    // cheap now (RPC aggregates), and 30s is short enough that counts never
    // look stale for long.
    staleTimes: {
      dynamic: 30,
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
