import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://f968b31bb033505a7ae3975d38809305@o4512057701761024.ingest.us.sentry.io/4512180530774016",

  // Capture a representative sample of transactions for performance monitoring.
  tracesSampleRate: 1.0,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
