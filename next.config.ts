import type { NextConfig } from "next";

/**
 * Next.js configuration.
 *
 * Cache Components and Partial Prefetching are disabled on purpose: every page in
 * this app depends on the authenticated session and on live database rows, so the
 * caching model would only add streaming and opt-out work without any benefit.
 *
 * `serverExternalPackages` keeps the database drivers out of the bundler. PGlite
 * ships WebAssembly files and pg opens raw sockets, so both must load from
 * node_modules at runtime instead of being traced into the server bundle.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  images: {
    // Reward photos come from object storage or a pasted public URL, so any
    // HTTPS host is allowed; next/image still optimises and sizes them.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  turbopack: {
    // Pin the workspace root so a lockfile in a parent folder is never picked up.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
