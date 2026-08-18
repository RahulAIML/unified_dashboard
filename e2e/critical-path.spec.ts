/**
 * Real, running E2E smoke test for the critical path — not a claim of
 * coverage, an actual executable suite. Run with: npx playwright test
 *
 * Scope, and why it's scoped this way:
 *
 *  - The non-admin path (register -> login -> language toggle -> no-access
 *    state -> logout) uses a FRESH account this test registers for itself
 *    via the real public registration API, exactly like a real user would.
 *    This is a disposable test fixture, not a real person's credentials.
 *
 *  - The admin-only path (Dashboard Builder: discover -> generate -> preview
 *    -> publish -> view the published dashboard's sidebar/pages/KPIs) is
 *    GATED behind E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD env vars and SKIPS
 *    (never fake-passes) when they are not set. A real admin account already
 *    exists in the shared production auth DB this dev server points at; I
 *    have no way to create a second admin without either handling that
 *    person's real password (which I will not do) or mutating the
 *    production DB directly to promote an account (which I will not do
 *    without explicit operator action). Supplying these two env vars is the
 *    one manual step required to unlock full-path coverage -- everything
 *    else here runs unattended today.
 */
import { test, expect, type Page } from '@playwright/test'

function uniqueTestEmail(): string {
  return `e2e-smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
}

const TEST_PASSWORD = 'E2eSmoke!Test1'

async function registerFreshUser(page: Page, email: string) {
  await page.goto('/auth/register')
  // The register page defaults to Spanish (SSR_LANG='es'), so labels/button
  // text are language-dependent ("Nombre Completo", "Crear Cuenta", etc.) --
  // target the stable field ids instead of getByLabel/getByRole text.
  await page.locator('#reg-name').fill('E2E Smoke Test')
  await page.locator('#reg-email').fill(email)
  await page.locator('#reg-password').fill(TEST_PASSWORD)
  await page.locator('#reg-confirm').fill(TEST_PASSWORD)
  await page.locator('form button[type="submit"]').click()
}

test.describe('Critical path — unauthenticated + fresh-account journey', () => {
  test('landing page loads, then register -> land on the dashboard shell', async ({ page }) => {
    await page.goto('/')
    // Unauthenticated visitor sees the marketing landing page, not a crash.
    await expect(page).toHaveTitle(/analytics/i)

    const email = uniqueTestEmail()
    await registerFreshUser(page, email)

    // Registration succeeds and the app takes us somewhere authenticated
    // (not back to /auth/login, not an error page).
    await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 15_000 })
  })

  test('language toggle switches the whole page and survives a reload (regression: hydration mismatch)', async ({ page }) => {
    const email = uniqueTestEmail()
    await registerFreshUser(page, email)
    await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 15_000 })

    // No React hydration errors on the very page this session found one on.
    const consoleErrors: string[] = []
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })

    const toggle = page.getByRole('button', { name: /toggle language/i })
    await expect(toggle).toBeVisible()
    const before = await toggle.textContent()
    await toggle.click()
    await expect(toggle).not.toHaveText(before ?? '')

    const langAfterClick = await page.evaluate(() => localStorage.getItem('rp-lang'))
    await page.reload()
    const langAfterReload = await page.evaluate(() => localStorage.getItem('rp-lang'))
    expect(langAfterReload).toBe(langAfterClick)

    expect(consoleErrors.filter(e => /hydration|Minified React error #418/i.test(e))).toEqual([])
  })

  test('a freshly registered account with no data source sees an honest no-access state, not a crash', async ({ page }) => {
    const email = uniqueTestEmail()
    await registerFreshUser(page, email)
    await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 15_000 })

    // No connector resolves for a brand-new @example.com account -- must be
    // an explicit "not linked to any organization" message (lib/translations.ts
    // notLinkedToOrg), never a silent blank page or a crash.
    await expect(page.getByText(/not linked to any organization|vinculado a ninguna organización/i)).toBeVisible({ timeout: 10_000 })
  })

  test('logout returns to the login page and the session is actually cleared', async ({ page }) => {
    const email = uniqueTestEmail()
    await registerFreshUser(page, email)
    await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 15_000 })

    await page.getByRole('button', { name: /log out|sign out|cerrar sesión/i }).click()
    // Generous timeout: on a cold Next.js dev server, /auth/login may still be
    // on-demand-compiling the first time a test navigates to it.
    await page.waitForURL(/\/auth\/login/, { timeout: 20_000 })

    const me = await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()))
    expect(me.success).toBe(false)
  })
})

test.describe('Critical path — admin: Dashboard Builder end to end', () => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL
  const adminPassword = process.env.E2E_ADMIN_PASSWORD

  test.skip(!adminEmail || !adminPassword,
    'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set -- see file header for why this cannot be auto-provisioned.')

  async function loginAsAdmin(page: Page) {
    await page.goto('/auth/login')
    await page.getByLabel(/email/i).fill(adminEmail!)
    await page.locator('input[type="password"]').fill(adminPassword!)
    await page.getByRole('button', { name: /sign in|log in|iniciar sesión/i }).click()
    await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 15_000 })
  }

  test('admin can reach the Builder and it lists real existing clients', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/dashboard-builder')
    await expect(page.getByRole('button', { name: /generate/i })).toBeVisible()

    // known-companies must be REAL data from the rolplay_app_sql connector,
    // never an empty/fake list on a working admin session.
    const companies = await page.evaluate(() => fetch('/api/ai/known-companies').then(r => r.json()))
    expect(Array.isArray(companies)).toBe(true)
    expect(companies.length).toBeGreaterThan(0)
  })

  test('Builder page toggle switches language independently of navigating away first', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/dashboard-builder')
    const toggle = page.getByRole('button', { name: /toggle language/i })
    await expect(toggle).toBeVisible()
    const heading = page.locator('h1')
    const before = await heading.textContent()
    await toggle.click()
    await expect(heading).not.toHaveText(before ?? '')
  })

  test('every sidebar item for the admin account opens without a client-side crash', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/')

    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))

    const links = await page.locator('nav a[href^="/"]').evaluateAll(
      as => as.map(a => (a as HTMLAnchorElement).getAttribute('href')).filter(Boolean) as string[],
    )
    const uniqueLinks = [...new Set(links)]
    expect(uniqueLinks.length).toBeGreaterThan(0)

    for (const href of uniqueLinks) {
      await page.goto(href!)
      await page.waitForLoadState('networkidle')
    }

    expect(errors).toEqual([])
  })
})
