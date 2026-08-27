import type { NextConfig } from "next";

// package.json's "build" script passes --webpack, NOT the Next 16 default of
// Turbopack -- next@16.3.3's Turbopack has a real regression parsing Tailwind
// v4's generated `@layer properties{@supports (...) or (...) {...}}` reset
// (fails with "Invalid dangling combinator in selector" on app/globals.css,
// confirmed on 16.3.3, the current latest stable; no newer patch exists yet).
// `next build --webpack` compiles the exact same app with no errors. Revisit
// once a Next.js patch lands that fixes this -- `next dev` is unaffected by
// this config and still uses Turbopack.
const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
