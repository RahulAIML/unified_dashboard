export const dynamic = "force-dynamic";

// A deliberate server-side error, used only to verify Sentry's server-side
// instrumentation (instrumentation.ts -> sentry.server.config.ts) actually
// reaches the dashboard after a deploy. Not part of any real feature.
class SentryExampleAPIError extends Error {
  constructor(message: string | undefined) {
    super(message);
    this.name = "SentryExampleAPIError";
  }
}

export function GET(): never {
  throw new SentryExampleAPIError("This error is raised on the backend called by the example page.");
}
