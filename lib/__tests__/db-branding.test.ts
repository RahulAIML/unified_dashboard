/**
 * Regression tests for the branding cross-user leak.
 *
 * The bug: /api/branding read and wrote a single row keyed by
 * brandingTenantKey(email, customerId) — one row shared by EVERY user at a
 * company. One person renaming the platform or changing colors overwrote it
 * for every other signed-in user. brandingUserKey/getBrandingSettingsForUser
 * give each user their own row while still falling back to the org default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authQuery = vi.fn()
vi.mock('../db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
}))

async function load() {
  vi.resetModules()
  return import('../db-branding')
}

const ORG_ROW = {
  logo_url: '/org-logo.png', primary_color: '#111111',
  secondary_color: '#222222', accent_color: '#333333',
}
const USER_A_ROW = {
  logo_url: '/user-a-logo.png', primary_color: '#aaaaaa',
  secondary_color: '#bbbbbb', accent_color: '#cccccc',
}

beforeEach(() => authQuery.mockReset())

describe('brandingUserKey', () => {
  it('produces a distinct key per user id', async () => {
    const { brandingUserKey } = await load()
    expect(brandingUserKey(1)).toBe('user:1')
    expect(brandingUserKey(1)).not.toBe(brandingUserKey(2))
  })
})

describe('getBrandingSettingsForUser — the leak this closes', () => {
  it("one user's saved row does not leak into another user's read", async () => {
    const { getBrandingSettingsForUser } = await load()
    // Only user 1 has ever saved anything.
    authQuery.mockImplementation(async (_sql: string, params: unknown[] = []) =>
      params[0] === 'user:1' ? [USER_A_ROW] : [],
    )

    const user1 = await getBrandingSettingsForUser(1, 'a@acme.test', 0)
    const user2 = await getBrandingSettingsForUser(2, 'b@acme.test', 0)

    expect(user1.logo_url).toBe('/user-a-logo.png')
    // User 2 never customized — must NOT see user 1's branding.
    expect(user2.logo_url).not.toBe('/user-a-logo.png')
  })

  it('falls back to the org-wide row for a user with no personal row yet', async () => {
    const { getBrandingSettingsForUser } = await load()
    authQuery.mockImplementation(async (_sql: string, params: unknown[] = []) =>
      params[0] === 'domain:acme.test' ? [ORG_ROW] : [],
    )

    const settings = await getBrandingSettingsForUser(99, 'new@acme.test', 0)

    expect(settings.logo_url).toBe('/org-logo.png')
  })

  it('prefers the personal row over the org row when both exist', async () => {
    const { getBrandingSettingsForUser } = await load()
    authQuery.mockImplementation(async (_sql: string, params: unknown[] = []) => {
      if (params[0] === 'user:1') return [USER_A_ROW]
      if (params[0] === 'domain:acme.test') return [ORG_ROW]
      return []
    })

    const settings = await getBrandingSettingsForUser(1, 'a@acme.test', 0)

    expect(settings.logo_url).toBe('/user-a-logo.png')
  })

  it('falls back to DEFAULT when neither personal nor org row exists', async () => {
    const { getBrandingSettingsForUser, brandingUserKey } = await load()
    const { DEFAULT_BRANDING_SETTINGS } = await import('../branding')
    authQuery.mockResolvedValue([])

    const settings = await getBrandingSettingsForUser(1, 'a@nobody.test', 0)

    expect(settings).toEqual(DEFAULT_BRANDING_SETTINGS)
    expect(brandingUserKey(1)).toBe('user:1')
  })
})

describe('upsertBrandingSettings — write isolation', () => {
  it('writes to whatever key it is given (the route must pass the user key)', async () => {
    const { upsertBrandingSettings } = await load()
    authQuery.mockResolvedValue([USER_A_ROW])

    await upsertBrandingSettings('user:1', 0, {
      logo_url: '/x.png', primary_color: '#000000', secondary_color: '#000000', accent_color: '#000000',
    })

    const [sql, params] = authQuery.mock.calls[0]
    expect(sql).toContain('ON CONFLICT (tenant_key)')
    expect(params[1]).toBe('user:1')
  })
})
