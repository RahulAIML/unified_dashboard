/**
 * /api/dashboard-view/[slug] is what makes "click Publish -> visible to the
 * real tenant" true. Before this route, publishing an AI-generated dashboard
 * only wrote domain->tenant routing metadata for the EXISTING hand-built
 * pages; the AI-generated config itself (/d/[slug]) was reachable only by an
 * admin through the builder's own admin-gated proxy. This route lets any
 * authenticated user view it, but ONLY if their resolved tenant actually owns
 * the slug — verified via the exact same functions every other route in this
 * app already uses for isolation (resolvePharmaTenant, resolveRolplayAppAccess),
 * never a new ad hoc rule. These tests assert the GATE, mirroring
 * ai-proxy-auth.test.ts's pattern for the sibling admin-only proxy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const getAuthContextFromRequest = vi.fn()
const authQuery = vi.fn()
const findUserById = vi.fn()
const resolvePharmaTenant = vi.fn()
const resolveRolplayAppAccess = vi.fn()
const fetchSpy = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  getAuthContextFromRequest: (...a: unknown[]) => getAuthContextFromRequest(...a),
}))
vi.mock('@/lib/db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
}))
vi.mock('@/lib/db-users', () => ({
  findUserById: (...a: unknown[]) => findUserById(...a),
}))
vi.mock('@/lib/pharma-tenant', () => ({
  resolvePharmaTenant: (...a: unknown[]) => resolvePharmaTenant(...a),
}))
vi.mock('@/lib/bridge-rolplay-app', () => ({
  resolveRolplayAppAccess: (...a: unknown[]) => resolveRolplayAppAccess(...a),
}))

async function loadRoute() {
  vi.resetModules()
  return import('../[slug]/route')
}

function req() {
  return new NextRequest('http://localhost:3000/api/dashboard-view/siigo')
}
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

function mockPublishedConfig(connector: string, connectorHandle: Record<string, unknown> = {}) {
  authQuery.mockResolvedValue([
    { config: JSON.stringify({ connector, connector_handle: connectorHandle }) },
  ])
}

beforeEach(() => {
  getAuthContextFromRequest.mockReset()
  authQuery.mockReset()
  findUserById.mockReset()
  resolvePharmaTenant.mockReset()
  resolveRolplayAppAccess.mockReset()
  fetchSpy.mockReset()
  findUserById.mockResolvedValue({ role: 'user' })
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ config: {}, preview: { widgets: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/dashboard-view/[slug]', () => {
  it('rejects an invalid slug format with 400', async () => {
    const { GET } = await loadRoute()
    const res = await GET(req(), ctx('../etc'))
    expect(res.status).toBe(400)
    expect(authQuery).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller with 401', async () => {
    getAuthContextFromRequest.mockResolvedValue(null)
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(401)
    expect(authQuery).not.toHaveBeenCalled()
  })

  it('returns 404 when nothing is published for this slug', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@siigo.com', customerId: 0 })
    authQuery.mockResolvedValue([])
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('denies a rolplay_app_sql viewer whose client_id does not own the slug', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'intruder@other.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 })
    resolveRolplayAppAccess.mockResolvedValue(999) // a different client
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows a rolplay_app_sql viewer whose resolved client_id owns the slug', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'real@siigo.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 })
    resolveRolplayAppAccess.mockResolvedValue(29)
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('denies a pharma viewer whose resolved tenant does not match the slug', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@takeda.com', customerId: 0 })
    mockPublishedConfig('pharma_kpi')
    resolvePharmaTenant.mockResolvedValue('takeda') // resolves to a DIFFERENT tenant than the slug below
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('apotex'))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows a pharma viewer whose resolved tenant matches the slug', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@apotex.com', customerId: 0 })
    mockPublishedConfig('pharma_kpi')
    resolvePharmaTenant.mockResolvedValue('apotex')
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('apotex'))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('denies a connector with no verified per-user resolver (e.g. coach_app_sql), never guesses', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@takeda.com', customerId: 0 })
    mockPublishedConfig('coach_app_sql', { customer_id: 42 })
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('takeda'))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('lets an admin view any published dashboard regardless of tenant match', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 99, email: 'admin@rolplay.ai', customerId: 0 })
    findUserById.mockResolvedValue({ role: 'admin' })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 })
    resolveRolplayAppAccess.mockResolvedValue(null) // admin isn't even a real user of this client
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('strips admin_only pages from the response for a non-admin viewer', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'real@siigo.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 })
    resolveRolplayAppAccess.mockResolvedValue(29)
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      config: { pages: [{ id: 'overview', visibility: 'all_users' }, { id: 'secret', visibility: 'admin_only' }] },
      preview: { widgets: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))
    const body = await res.json()

    expect(body.config.pages.map((p: { id: string }) => p.id)).toEqual(['overview'])
  })

  it('keeps every page, including admin_only, for an admin viewer', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 99, email: 'admin@rolplay.ai', customerId: 0 })
    findUserById.mockResolvedValue({ role: 'admin' })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 })
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({
      config: { pages: [{ id: 'overview', visibility: 'all_users' }, { id: 'secret', visibility: 'admin_only' }] },
      preview: { widgets: [] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))
    const body = await res.json()

    expect(body.config.pages.map((p: { id: string }) => p.id)).toEqual(['overview', 'secret'])
  })

  it('leaves a config with no pages array untouched', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'real@siigo.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 })
    resolveRolplayAppAccess.mockResolvedValue(29)
    // default fetchSpy mock already returns { config: {}, preview: {...} }
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))
    expect(res.status).toBe(200)
  })

  it('sends X-Internal-Auth to the ai-service when configured', async () => {
    process.env.AI_SERVICE_SHARED_SECRET = 'test-secret'
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'real@siigo.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 })
    resolveRolplayAppAccess.mockResolvedValue(29)
    const { GET } = await loadRoute()

    await GET(req(), ctx('siigo'))

    const [, init] = fetchSpy.mock.calls[0]
    expect(init.headers['X-Internal-Auth']).toBe('test-secret')
    delete process.env.AI_SERVICE_SHARED_SECRET
  })
})
