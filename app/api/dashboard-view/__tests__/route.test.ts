/**
 * /api/dashboard-view/[slug] is what makes "click Publish -> visible to the
 * real tenant" true. Before this route, publishing an AI-generated dashboard
 * only wrote domain->tenant routing metadata for the EXISTING hand-built
 * pages; the AI-generated config itself (/d/[slug]) was reachable only by an
 * admin through the builder's own admin-gated proxy. This route lets any
 * authenticated user view it, but ONLY if their resolved tenant actually owns
 * the slug — verified via the exact same functions every other route in this
 * app already uses for isolation (resolvePharmaTenantAccess, resolveRolplayAppAccess),
 * never a new ad hoc rule. These tests assert the GATE, mirroring
 * ai-proxy-auth.test.ts's pattern for the sibling admin-only proxy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const getAuthContextFromRequest = vi.fn()
const authQuery = vi.fn()
const findUserById = vi.fn()
const resolvePharmaTenantAccess = vi.fn()
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
  resolvePharmaTenantAccess: (...a: unknown[]) => resolvePharmaTenantAccess(...a),
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

function mockPublishedConfig(connector: string, connectorHandle: Record<string, unknown> = {}, authorizedEmails?: string[]) {
  authQuery.mockResolvedValue([
    { config: JSON.stringify({ connector, connector_handle: connectorHandle, authorized_emails: authorizedEmails }) },
  ])
}

beforeEach(() => {
  getAuthContextFromRequest.mockReset()
  authQuery.mockReset()
  findUserById.mockReset()
  resolvePharmaTenantAccess.mockReset()
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
    resolvePharmaTenantAccess.mockResolvedValue('takeda') // resolves to a DIFFERENT tenant than the slug below
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('apotex'))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows a pharma viewer whose resolved tenant matches the slug', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'a@apotex.com', customerId: 0 })
    mockPublishedConfig('pharma_kpi')
    resolvePharmaTenantAccess.mockResolvedValue('apotex')
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

  it('denies a real, tenant-verified user who is not on the dashboard\'s authorized_emails allowlist', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'real@siigo.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 }, ['admin@siigo.com'])
    resolveRolplayAppAccess.mockResolvedValue(29) // a genuine, verified real user of this tenant
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    // The tenant check alone would have let this user in -- the allowlist,
    // when configured, narrows access further on top of it.
    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows a real, tenant-verified user who IS on the authorized_emails allowlist', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'Admin@Siigo.com  ', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 }, ['admin@siigo.com'])
    resolveRolplayAppAccess.mockResolvedValue(29)
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    // Case/whitespace must not matter -- the same normalization as every
    // other email comparison in this codebase (lowercase, trim).
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('applies no extra restriction when authorized_emails is empty/absent (default, unchanged behavior)', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'real@siigo.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 }, [])
    resolveRolplayAppAccess.mockResolvedValue(29)
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(200)
  })

  it('still lets an admin view a dashboard even when they are not on its authorized_emails allowlist', async () => {
    getAuthContextFromRequest.mockResolvedValue({ userId: 99, email: 'admin@rolplay.ai', customerId: 0 })
    findUserById.mockResolvedValue({ role: 'admin' })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 }, ['someone-else@siigo.com'])
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('denies a domain squatter with a lookalike email even if the allowlist would otherwise be irrelevant', async () => {
    // The allowlist can only NARROW access -- it never substitutes for the
    // tenant check. A non-tenant-verified email must still be denied even if
    // it happens to appear on some other dashboard's allowlist by coincidence.
    getAuthContextFromRequest.mockResolvedValue({ userId: 1, email: 'admin@siigo.com', customerId: 0 })
    mockPublishedConfig('rolplay_app_sql', { client_id: 29 }, ['admin@siigo.com'])
    resolveRolplayAppAccess.mockResolvedValue(null) // NOT a verified real user of this tenant
    const { GET } = await loadRoute()

    const res = await GET(req(), ctx('siigo'))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
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
