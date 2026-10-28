import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Fixed internal API; never forward to a URL supplied by a browser request.
    return ['/docs/:path*', '/openapi.json', '/v1/:path*', '/health', '/merchants'].map(source => ({
      source, destination: `http://127.0.0.1:3000${source}`,
    }));
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
