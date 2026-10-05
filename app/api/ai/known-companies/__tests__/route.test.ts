/**
 * Regression: the Dashboard Builder's company picker (GET /api/ai/known-
 * companies) only ever queried rolplay_app_sql's r_client table via
 * ai-service. Reported live: Heineken was invited/registered but never
 * showed up in the picker, so the name had to be typed by hand, defeating
 * the point of the menu.
 *
 * First fix attempt only added lib/db-tenants.ts's pharma_tenants DB table
 * as a second source -- verified LIVE against the real Render Postgres this
 * app actually uses that this was still incomplete: Heineken has zero rows
 * in that table. It's a HARDCODED tenant in lib/pharma-tenant.ts's
 * TENANT_CONFIG (an already-deployed client onboarded before the
 * self-service DB-backed wizard existed) -- confirmed by /admin/tenants,
 * which lists it as a registered client via exactly this hardcoded-plus-DB
 * merge (app/api/admin/tenants/route.ts). This route now does the same
 * merge, which is the actual, verified fix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireAdminFromRequest = vi.fn()
const rateLimit = vi.fn()
const listAllTenants = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  requireAdminFromRequest: (...args: unknown[]) => requireAdminFromRequest(...args),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitHeaders: () => ({}),
}))
vi.mock('@/lib/db-tenants', () => ({
  listAllTenants: (...args: unknown[]) => listAllTenants(...args),
}))
// A small, fixed stand-in for the real (much larger) hardcoded config --
// exercises the exact same merge logic without depending on the real
// tenant roster staying in sync with this test.
vi.mock('@/lib/pharma-tenant', () => ({
  TENANT_CONFIG: {
    heineken: { kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/heineken', ucids: [] },
    m8: { kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/m8', ucids: [] },
  },
}))

const fetchSpy = vi.fn()

async function loadRoute() {
  vi.resetModules()
  return import('../route')
}

const ADMIN = { userId: 1, email: 'admin@rolplay.ai', customerId: 0, role: 'admin' as const }

function getReq() {
  return new NextRequest('http://localhost:3000/api/ai/known-companies')
}

function dbTenant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenantKey: 'acme', displayName: 'Acme', kind: 'kpi', url: 'x', xTenant: null,
    ucids: [], hasCertification: false, hasObjections: false, hasBusinessLines: false,
    hasOrganization: false, hasTopStats: false, hasLms: null, hasSimulator: null,
    coachActivityIds: null, authHeaderName: null, authHeaderValue: null, passThreshold: null,
    hasNoPassingCriteria: false, isActive: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  requireAdminFromRequest.mockReset().mockResolvedValue(ADMIN)
  rateLimit.mockReset().mockReturnValue({ ok: true, remaining: 59 })
  listAllTenants.mockReset().mockResolvedValue([])
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/ai/known-companies', () => {
  it('rejects a non-admin the same way the AI proxy does', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { GET } = await loadRoute()
    const res = await GET(getReq())
    expect(res.status).toBe(403)
  })

  it('surfaces a hardcoded (code-only) pharma tenant even with an EMPTY pharma_tenants table -- the actual reported bug', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    listAllTenants.mockResolvedValue([]) // pharma_tenants table has zero rows for Heineken, exactly as verified live

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.map((c: { name: string }) => c.name)).toContain('heineken')
  })

  it('merges a real rolplay_app_sql client with a self-service (DB) pharma tenant', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', sessions: 154, users: 73 }],
    })
    listAllTenants.mockResolvedValue([dbTenant({ tenantKey: 'newco', displayName: 'NewCo' })])

    const { GET } = await loadRoute()
    const res = await GET(getReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    const names = body.map((c: { name: string }) => c.name)
    expect(names).toContain('Siigo')
    expect(names).toContain('NewCo')
  })

  it('excludes an inactive DB tenant', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    listAllTenants.mockResolvedValue([dbTenant({ tenantKey: 'retired', displayName: 'Retired Co', isActive: false })])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.map((c: { name: string }) => c.name)).not.toContain('Retired Co')
  })

  it('a DB row for a hardcoded key wins over the hardcoded entry, not a duplicate', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    // Heineken migrated from code to the DB, with a proper display name.
    listAllTenants.mockResolvedValue([dbTenant({ tenantKey: 'heineken', displayName: 'Heineken NV' })])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    const heinekenEntries = body.filter((c: { name: string }) => c.name.toLowerCase().includes('heineken'))
    expect(heinekenEntries.length).toBe(1)
    expect(heinekenEntries[0].name).toBe('Heineken NV')
  })

  it('flags a DB pharma tenant created within the last 14 days as isNew', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    listAllTenants.mockResolvedValue([dbTenant({ tenantKey: 'newco', displayName: 'NewCo', createdAt: new Date().toISOString() })])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'NewCo').isNew).toBe(true)
  })

  it('does not flag a DB pharma tenant created long ago as isNew', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    listAllTenants.mockResolvedValue([dbTenant({ tenantKey: 'oldco', displayName: 'OldCo', createdAt: longAgo })])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'OldCo').isNew).toBe(false)
  })

  it('never flags a hardcoded tenant as isNew (no creation-date signal exists for it)', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    listAllTenants.mockResolvedValue([])
    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'heineken').isNew).toBe(false)
  })

  it('flags a rolplay_app_sql client created within the last 14 days as isNew (real r_client.created_on)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 39, name: 'Mastercard', created_on: new Date().toISOString(), sessions: 0, users: 0 }],
    })

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'Mastercard').isNew).toBe(true)
  })

  it('does not flag a rolplay_app_sql client created long ago as isNew', async () => {
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', created_on: longAgo, sessions: 154, users: 73 }],
    })

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'Siigo').isNew).toBe(false)
  })

  it('does not flag a rolplay_app_sql client as isNew when created_on is missing or unparseable', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', created_on: null, sessions: 154, users: 73 }],
    })

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'Siigo').isNew).toBe(false)
  })

  it('a name known to both rolplay_app_sql and pharma keeps the rolplay_app_sql entry (real data wins), not a duplicate', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 24, name: 'M8', sessions: 872, users: 92 }],
    })
    listAllTenants.mockResolvedValue([]) // m8 comes from TENANT_CONFIG (hardcoded) in this test's mock

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    const m8Entries = body.filter((c: { name: string }) => c.name.toLowerCase() === 'm8')
    expect(m8Entries.length).toBe(1)
    expect(m8Entries[0].source).toBe('rolplay_app_sql')
    expect(m8Entries[0].sessions).toBe(872)
  })

  it('sorts newly-invited (DB) tenants first, ahead of real clients with more sessions', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', sessions: 154, users: 73 }],
    })
    listAllTenants.mockResolvedValue([dbTenant({ tenantKey: 'newco', displayName: 'NewCo' })])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body[0].name).toBe('NewCo')
  })

  it('degrades gracefully when the ai-service call fails, still returning pharma tenants', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'))
    listAllTenants.mockResolvedValue([])

    const { GET } = await loadRoute()
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['heineken', 'm8']))
  })

  it('degrades gracefully when the DB call fails, still returning hardcoded and rolplay_app_sql tenants', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', sessions: 154, users: 73 }],
    })
    listAllTenants.mockRejectedValue(new Error('db unreachable'))

    const { GET } = await loadRoute()
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Siigo', 'heineken']))
  })
})
