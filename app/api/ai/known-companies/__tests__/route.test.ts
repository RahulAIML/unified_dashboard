/**
 * Regression: the Dashboard Builder's company picker (GET /api/ai/known-
 * companies) only ever queried rolplay_app_sql's r_client table via
 * ai-service. A client invited through the self-service admin wizard
 * (POST /api/admin/tenants -> lib/db-tenants.ts's pharma_tenants table)
 * never appeared here at all -- reported live: Heineken was invited but
 * never showed up in the picker, so the name had to be typed by hand,
 * defeating the point of the menu. This route now merges both sources and
 * flags a recently-invited pharma tenant with isNew for the UI's "Nuevo"
 * badge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireAdminFromRequest = vi.fn()
const rateLimit = vi.fn()
const listActiveTenants = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  requireAdminFromRequest: (...args: unknown[]) => requireAdminFromRequest(...args),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitHeaders: () => ({}),
}))
vi.mock('@/lib/db-tenants', () => ({
  listActiveTenants: (...args: unknown[]) => listActiveTenants(...args),
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

beforeEach(() => {
  requireAdminFromRequest.mockReset().mockResolvedValue(ADMIN)
  rateLimit.mockReset().mockReturnValue({ ok: true, remaining: 59 })
  listActiveTenants.mockReset().mockResolvedValue([])
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

  it('merges a real rolplay_app_sql client with a self-service pharma tenant', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', sessions: 154, users: 73 }],
    })
    listActiveTenants.mockResolvedValue([
      {
        tenantKey: 'heineken', displayName: 'Heineken', kind: 'exceltis_rest', url: 'x', xTenant: null,
        ucids: [], hasCertification: false, hasObjections: false, hasBusinessLines: false,
        hasOrganization: false, hasTopStats: false, hasLms: null, hasSimulator: null,
        coachActivityIds: null, authHeaderName: null, authHeaderValue: null, passThreshold: null,
        hasNoPassingCriteria: false, isActive: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ])

    const { GET } = await loadRoute()
    const res = await GET(getReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    const names = body.map((c: { name: string }) => c.name)
    expect(names).toContain('Siigo')
    expect(names).toContain('Heineken')
  })

  it('flags a pharma tenant created within the last 14 days as isNew', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    listActiveTenants.mockResolvedValue([
      {
        tenantKey: 'heineken', displayName: 'Heineken', kind: 'exceltis_rest', url: 'x', xTenant: null,
        ucids: [], hasCertification: false, hasObjections: false, hasBusinessLines: false,
        hasOrganization: false, hasTopStats: false, hasLms: null, hasSimulator: null,
        coachActivityIds: null, authHeaderName: null, authHeaderValue: null, passThreshold: null,
        hasNoPassingCriteria: false, isActive: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'Heineken').isNew).toBe(true)
  })

  it('does not flag a pharma tenant created long ago as isNew', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => [] })
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    listActiveTenants.mockResolvedValue([
      {
        tenantKey: 'apotex', displayName: 'Apotex', kind: 'kpi', url: 'x', xTenant: null,
        ucids: [], hasCertification: false, hasObjections: false, hasBusinessLines: false,
        hasOrganization: false, hasTopStats: false, hasLms: null, hasSimulator: null,
        coachActivityIds: null, authHeaderName: null, authHeaderValue: null, passThreshold: null,
        hasNoPassingCriteria: false, isActive: true, createdAt: longAgo, updatedAt: longAgo,
      },
    ])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'Apotex').isNew).toBe(false)
  })

  it('never flags a rolplay_app_sql entry as isNew (no creation-date signal exists for it)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', sessions: 154, users: 73 }],
    })
    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body.find((c: { name: string }) => c.name === 'Siigo').isNew).toBe(false)
  })

  it('a name known to both sources keeps the rolplay_app_sql entry (real data wins), not a duplicate', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 24, name: 'M8', sessions: 872, users: 92 }],
    })
    listActiveTenants.mockResolvedValue([
      {
        tenantKey: 'm8', displayName: 'M8', kind: 'exceltis_rest', url: 'x', xTenant: null,
        ucids: [], hasCertification: false, hasObjections: false, hasBusinessLines: false,
        hasOrganization: false, hasTopStats: false, hasLms: null, hasSimulator: null,
        coachActivityIds: null, authHeaderName: null, authHeaderValue: null, passThreshold: null,
        hasNoPassingCriteria: false, isActive: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    const m8Entries = body.filter((c: { name: string }) => c.name === 'M8')
    expect(m8Entries.length).toBe(1)
    expect(m8Entries[0].source).toBe('rolplay_app_sql')
    expect(m8Entries[0].sessions).toBe(872)
  })

  it('sorts newly-invited tenants first, ahead of real clients with more sessions', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 29, name: 'Siigo', sessions: 154, users: 73 }],
    })
    listActiveTenants.mockResolvedValue([
      {
        tenantKey: 'heineken', displayName: 'Heineken', kind: 'exceltis_rest', url: 'x', xTenant: null,
        ucids: [], hasCertification: false, hasObjections: false, hasBusinessLines: false,
        hasOrganization: false, hasTopStats: false, hasLms: null, hasSimulator: null,
        coachActivityIds: null, authHeaderName: null, authHeaderValue: null, passThreshold: null,
        hasNoPassingCriteria: false, isActive: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ])

    const { GET } = await loadRoute()
    const body = await (await GET(getReq())).json()
    expect(body[0].name).toBe('Heineken')
  })

  it('degrades gracefully to an empty list when the ai-service call fails, still returning pharma tenants', async () => {
    fetchSpy.mockRejectedValue(new Error('network error'))
    listActiveTenants.mockResolvedValue([
      {
        tenantKey: 'heineken', displayName: 'Heineken', kind: 'exceltis_rest', url: 'x', xTenant: null,
        ucids: [], hasCertification: false, hasObjections: false, hasBusinessLines: false,
        hasOrganization: false, hasTopStats: false, hasLms: null, hasSimulator: null,
        coachActivityIds: null, authHeaderName: null, authHeaderValue: null, passThreshold: null,
        hasNoPassingCriteria: false, isActive: true,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    ])

    const { GET } = await loadRoute()
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.map((c: { name: string }) => c.name)).toEqual(['Heineken'])
  })
})
