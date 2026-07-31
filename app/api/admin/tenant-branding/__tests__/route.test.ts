/**
 * Write side of the AI-generated-dashboard branding fix: an admin can set a
 * TENANT's default branding by domain, which ai-service's
 * branding_lookup.py reads at generation time (domain:<domain> key) and
 * lib/db-branding.ts's per-user fallback already reads for any signed-in
 * user at that domain. Admin-only, and distinct from PUT /api/branding
 * (which always writes the caller's own per-user row, never a named
 * tenant's).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const requireAdminFromRequest = vi.fn()
vi.mock('@/lib/server-auth', () => ({
  requireAdminFromRequest: (...a: unknown[]) => requireAdminFromRequest(...a),
}))

const store = new Map<string, Record<string, string>>()
vi.mock('@/lib/db-auth', () => ({
  authQuery: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT')) {
      const key = params[0] as string
      const row = store.get(key)
      return row ? [row] : []
    }
    const [, tenantKey, logo, secondary, primary, accent] = params as string[]
    const row = { logo_url: logo, primary_color: primary, secondary_color: secondary, accent_color: accent }
    store.set(tenantKey, row)
    return [row]
  }),
}))

async function loadRoute() {
  vi.resetModules()
  return import('../route')
}

function putReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/tenant-branding', {
    method: 'PUT', body: JSON.stringify(body),
  })
}
function getReq(domain: string) {
  return new NextRequest(`http://localhost/api/admin/tenant-branding?domain=${domain}`)
}

beforeEach(() => {
  store.clear()
  requireAdminFromRequest.mockReset()
})

describe('admin tenant-branding', () => {
  it('rejects a non-admin caller', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { PUT, GET } = await loadRoute()

    expect((await PUT(putReq({ domain: 'apotex.com', primary_color: '#111111' }))).status).toBe(403)
    expect((await GET(getReq('apotex.com'))).status).toBe(403)
  })

  it('rejects a missing/invalid domain', async () => {
    requireAdminFromRequest.mockResolvedValue({ userId: 1, role: 'admin' })
    const { PUT } = await loadRoute()

    const res = await PUT(putReq({ primary_color: '#111111' }))
    expect(res.status).toBe(400)
  })

  it('saves a tenant default that a domain-scoped GET reads back', async () => {
    requireAdminFromRequest.mockResolvedValue({ userId: 1, role: 'admin' })
    const { PUT, GET } = await loadRoute()

    const putRes = await PUT(putReq({
      domain: 'Apotex.COM', logo_url: '/apotex-logo.png',
      primary_color: '#123456', secondary_color: '#654321', accent_color: '#abcdef',
    }))
    expect(putRes.status).toBe(200)

    const getRes = await GET(getReq('apotex.com'))
    const body = await getRes.json()
    expect(body.data.settings.primary_color).toBe('#123456')
  })

  it("does not affect a DIFFERENT tenant's domain", async () => {
    requireAdminFromRequest.mockResolvedValue({ userId: 1, role: 'admin' })
    const { PUT, GET } = await loadRoute()

    await PUT(putReq({ domain: 'apotex.com', primary_color: '#111111' }))
    await PUT(putReq({ domain: 'siigo.com', primary_color: '#222222' }))

    const apotex = await (await GET(getReq('apotex.com'))).json()
    const siigo = await (await GET(getReq('siigo.com'))).json()
    expect(apotex.data.settings.primary_color).toBe('#111111')
    expect(siigo.data.settings.primary_color).toBe('#222222')
  })
})
