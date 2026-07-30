/**
 * End-to-end (route-level) proof that the branding leak is closed: two
 * different authenticated users hitting PUT then GET never see each other's
 * saved settings.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getAuthContextFromRequest = vi.fn()
vi.mock('@/lib/server-auth', () => ({
  getAuthContextFromRequest: (...a: unknown[]) => getAuthContextFromRequest(...a),
}))

// In-memory fake of the tenant_key-keyed table, mirroring real upsert semantics.
const store = new Map<string, Record<string, string>>()
vi.mock('@/lib/db-auth', () => ({
  authQuery: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT')) {
      const key = params[0] as string
      const row = store.get(key)
      return row ? [row] : []
    }
    // INSERT ... ON CONFLICT upsert
    const [, tenantKey, logo, secondary, primary, accent] = params as string[]
    const row = { logo_url: logo, primary_color: primary, secondary_color: secondary, accent_color: accent }
    store.set(tenantKey, row)
    return [row]
  }),
}))

async function loadRoute() {
  vi.resetModules()
  return import('../branding/route')
}

function putReq(body: unknown) {
  return new NextRequest('http://localhost/api/branding', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
const getReq = () => new NextRequest('http://localhost/api/branding')

beforeEach(() => {
  store.clear()
  getAuthContextFromRequest.mockReset()
})

describe('branding is isolated per authenticated user', () => {
  it("user B's GET never returns user A's saved logo", async () => {
    const { PUT, GET } = await loadRoute()

    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@acme.test', customerId: 0 })
    const putRes = await PUT(putReq({
      logo_url: '/a-logo.png', primary_color: '#111111', secondary_color: '#222222', accent_color: '#333333',
    }))
    expect(putRes.status).toBe(200)

    getAuthContextFromRequest.mockResolvedValue({ userId: 2, email: 'b@acme.test', customerId: 0 })
    const getRes = await GET(getReq())
    const body = await getRes.json()

    // This is the exact bug: before the fix, user B would see user A's logo.
    expect(body.data.settings.logo_url).not.toBe('/a-logo.png')
  })

  it("each user reads back exactly what they themselves saved", async () => {
    const { PUT, GET } = await loadRoute()

    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@acme.test', customerId: 0 })
    await PUT(putReq({ logo_url: '/a.png', primary_color: '#111111', secondary_color: '#111111', accent_color: '#111111' }))

    getAuthContextFromRequest.mockResolvedValue({ userId: 2, email: 'b@acme.test', customerId: 0 })
    await PUT(putReq({ logo_url: '/b.png', primary_color: '#222222', secondary_color: '#222222', accent_color: '#222222' }))

    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@acme.test', customerId: 0 })
    const aAgain = await (await GET(getReq())).json()
    expect(aAgain.data.settings.logo_url).toBe('/a.png')

    getAuthContextFromRequest.mockResolvedValue({ userId: 2, email: 'b@acme.test', customerId: 0 })
    const bAgain = await (await GET(getReq())).json()
    expect(bAgain.data.settings.logo_url).toBe('/b.png')
  })

  it('rejects an unauthenticated request on both verbs', async () => {
    const { PUT, GET } = await loadRoute()
    getAuthContextFromRequest.mockResolvedValue(null)

    expect((await GET(getReq())).status).toBe(401)
    expect((await PUT(putReq({}))).status).toBe(401)
  })
})
