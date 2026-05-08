/**
 * lib/demo/index.ts
 *
 * Central toggle for DEMO MODE.
 *
 * Set NEXT_PUBLIC_DEMO_MODE=true in .env.local to activate.
 * Works on both server (API routes) and client (UI indicators).
 *
 * To switch back to real APIs: remove the env var or set to 'false'.
 * No other code changes required.
 */

export const isDemoMode = (): boolean =>
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
