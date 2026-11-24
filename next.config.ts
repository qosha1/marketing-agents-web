import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@startsimpli/api",
    "@startsimpli/auth",
    "@startsimpli/forms",
    // TRANSITIVE, and required: @startsimpli/llm/translation imports
    // @startsimpli/i18n/bidi for stripIsolates (the storage normaliser), and
    // these packages ship raw TypeScript. Without this the build dies with
    // "Unknown module type" on bidi.ts — a failure only `next build` surfaces,
    // never tsc or vitest.
    "@startsimpli/i18n",
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
  // Research replaced the News and Approved Source tables and the all-kinds Topics
  // table (lane 2, epic startsim-tntrh). The old addresses still work. A topic
  // table with a Kind, a queue, a record to open or a return path is the content
  // spine's own view and is left alone.
  async redirects() {
    const keep = ["content_type", "open", "queue", "from", "since", "created_after"].map((key) => ({
      type: "query" as const,
      key,
    }));
    return [
      { source: "/t/news_item", destination: "/research/sources", permanent: false },
      { source: "/board/news_item", destination: "/research/sources", permanent: false },
      { source: "/t/source", destination: "/research/settings", permanent: false },
      { source: "/board/source", destination: "/research/settings", permanent: false },
      { source: "/t/topic", missing: keep, destination: "/research/topics", permanent: false },
      { source: "/board/topic", missing: keep, destination: "/research/topics", permanent: false },
    ];
  },
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
