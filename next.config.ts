import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@startsimpli/api",
    "@startsimpli/auth",
    "@startsimpli/forms",
    "@startsimpli/llm",
    "@startsimpli/ui",
  ],
  // Transpiled @startsimpli/* ship raw TS + untyped transitive deps, so a strict
  // build type-check fails on code this app doesn't own. Matches present-web /
  // vault-web and the other standalone apps.
  typescript: { ignoreBuildErrors: true },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  turbopack: {},
  async rewrites() {
    // Same-origin proxy: the browser calls /api/* (NEXT_PUBLIC_API_URL unset),
    // and Next forwards to the tenant Django backend server-side. DRF wants a
    // trailing slash, so we append one. `fallback` so any local Route Handlers
    // under /app/api/* would match first; the Django passthrough only fires for
    // /api/* paths with no matching handler.
    const djangoUrl = process.env.DJANGO_API_URL || "http://localhost:8001";
    return {
      fallback: [
        {
          source: "/api/:path*",
          destination: `${djangoUrl}/api/:path*/`,
        },
      ],
    };
  },
};

export default nextConfig;
