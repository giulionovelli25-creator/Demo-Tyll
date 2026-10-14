import type { NextConfig } from "next";

// The demo renders in the browser from a local store, so the server-data features
// (Cache Components, partial prefetching) that the scaffold switches on are left off.
const nextConfig: NextConfig = {
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
