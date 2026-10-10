import type { NextConfig } from "next";

// Built as static files (web/out) and served by FastAPI, so the app ships as one
// Cloud Run service. In development the UI calls the API on NEXT_PUBLIC_API_BASE.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
