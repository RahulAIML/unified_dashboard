"use client";

import * as Sentry from "@sentry/nextjs";
import { useState } from "react";

// Deliberate one-off test page, not part of any real feature -- exists only
// to verify Sentry's client AND server instrumentation actually reach the
// dashboard after a deploy, without needing to log into a real client
// account or wait for a real user to hit a real bug.
class SentryExampleFrontendError extends Error {
  constructor(message: string | undefined) {
    super(message);
    this.name = "SentryExampleFrontendError";
  }
}

export default function SentryExamplePage() {
  const [hasSentError, setHasSentError] = useState(false);
  const [isConnected, setIsConnected] = useState(true);

  const checkConnectivity = async () => {
    try {
      const response = await fetch("/api/sentry-example-api");
      if (response.ok) {
        setIsConnected(true);
      }
    } catch {
      setIsConnected(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-bold">sentry-example-page</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        Clicking the button below calls a route that always throws, then throws again on the
        client — both reported to Sentry. Delete this page once the integration is confirmed
        working.
      </p>
      <button
        type="button"
        className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50"
        disabled={!isConnected}
        onClick={async () => {
          await Sentry.startSpan(
            {
              name: "Example Frontend/Backend Span",
              op: "test",
            },
            async () => {
              const res = await fetch("/api/sentry-example-api");
              if (!res.ok) {
                setHasSentError(true);
                throw new SentryExampleFrontendError(
                  "This error is raised on the frontend of the example page."
                );
              }
            }
          );
        }}
      >
        Throw error!
      </button>
      {hasSentError && <p className="text-sm text-primary">Error sent to Sentry.</p>}
      {!isConnected && (
        <button
          type="button"
          className="text-xs underline text-muted-foreground"
          onClick={checkConnectivity}
        >
          Retry connectivity check
        </button>
      )}
    </div>
  );
}
