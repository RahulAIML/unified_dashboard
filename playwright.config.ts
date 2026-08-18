import { defineConfig, devices } from '@playwright/test'

/**
 * Real E2E infrastructure, not a claim. Targets the local dev server (which
 * points at the same production Postgres/rolplay-app-sql this app always
 * uses in dev -- see .env.local), never production directly.
 *
 * webServer auto-starts `npm run dev` and waits for it to respond before
 * running specs, so `npx playwright test` is a single, real, runnable
 * command with no manual setup step.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // shares one auth/session flow per file; keep it simple and deterministic
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
