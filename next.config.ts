import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Avoid process forking in locked-down Windows environments by using worker_threads,
    // and keep worker count low to reduce resource pressure during build.
    workerThreads: true,
    cpus: 1,
  },
  typescript: {
    // Next's build-time typecheck spawns a separate process on Windows; in locked-down
    // environments this can fail with EPERM. We keep type safety via `npm run typecheck`.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
