import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// package.json's "build" AND "dev" scripts both pass --webpack, NOT the
// Next 16 default of Turbopack -- next@16.3.3's Turbopack has a real
// regression parsing Tailwind v4's generated
// `@layer properties{@supports (...) or (...) {...}}` reset (fails with
// "Invalid dangling combinator in selector" on app/globals.css, confirmed
// on 16.3.3, the current latest stable; no newer patch exists yet, and this
// hits `next dev` exactly the same as `next build`). `--webpack` compiles
// the exact same app with no errors either way. Revisit once a Next.js
// patch lands that fixes this.
const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "rolplay-jl",
  project: "self-service-dashboard-frontend",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Deliberately NOT setting tunnelRoute: middleware.ts's matcher
  // ('/((?!_next/static|_next/image|favicon.ico).*)') covers every non-API
  // page route, including a tunnel path, and redirects any unauthenticated
  // request to /auth/login -- a tunneled Sentry beacon would get silently
  // redirected instead of forwarded, so errors would stop reaching Sentry
  // for exactly the users most likely to need it (logged-out / session-
  // expired). Reporting straight to the ingest domain instead means some
  // ad-blockers may block it, but that's a visible partial gap, not a
  // silent total one.
});
