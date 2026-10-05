/**
 * The AI proxy fronts tenant provisioning and dashboard PUBLISH, and it shipped
 * with no authentication at all — middleware.ts skips every /api/ route, so
 * there was no gate at either layer. These tests exist so that can never
 * silently return.
 *
 * They assert on the GATE only, never on upstream behaviour: an unauthorised
 * caller must be refused BEFORE any fetch to the AI service happens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const requireAdminFromRequest = vi.fn()
const fetchSpy = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  requireAdminFromRequest: (...a: unknown[]) => requireAdminFromRequest(...a),
}))

async function loadRoute() {
  vi.resetModules()
  return import('../../ai/[...path]/route')
}

function req(method = 'POST', body?: string) {
  return new NextRequest('http://localhost:3000/api/ai/generate-dashboard', {
    method,
    ...(body === undefined ? {} : { body }),
  })
}

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) })

beforeEach(() => {
  requireAdminFromRequest.mockReset()
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('AI proxy authorisation', () => {
  it('rejects an unauthenticated caller with 403', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { POST } = await loadRoute()

    const res = await POST(req('POST', '{}'), ctx(['generate-dashboard']))

    expect(res.status).toBe(403)
  })

  it('rejects a signed-in NON-admin with 403', async () => {
    // requireAdminFromRequest returns null for a valid non-admin session too.
    requireAdminFromRequest.mockResolvedValue(null)
    const { POST } = await loadRoute()

    const res = await POST(req('POST', '{}'), ctx(['publish']))

    expect(res.status).toBe(403)
  })

  it('never contacts the AI service when unauthorised', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { POST } = await loadRoute()

    await POST(req('POST', '{}'), ctx(['publish']))

    // The whole point: no provisioning work may be triggered by a rejected call.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('gates GET as well as POST', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { GET } = await loadRoute()

    const res = await GET(req('GET'), ctx(['status', 'job-1']))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('gates DELETE too', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { DELETE } = await loadRoute()

    const res = await DELETE(req('DELETE'), ctx(['knowledge', 'takeda']))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards a DELETE for an authenticated admin, e.g. clearing stale company knowledge', async () => {
    requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
    const { DELETE } = await loadRoute()

    const res = await DELETE(req('DELETE'), ctx(['knowledge', 'takeda']))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect(init.method).toBe('DELETE')
  })

  it('gates PATCH too', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { PATCH } = await loadRoute()

    const res = await PATCH(req('PATCH', '{}'), ctx(['dashboard', 'salinas', 'required-sections']))

    expect(res.status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('forwards a PATCH for an authenticated admin, e.g. editing required sections', async () => {
    requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
    const { PATCH } = await loadRoute()

    const res = await PATCH(req('PATCH', '{"sections":["lms"]}'), ctx(['dashboard', 'salinas', 'required-sections']))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect(init.method).toBe('PATCH')
  })

  it('forwards for an authenticated admin', async () => {
    requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
    const { POST } = await loadRoute()

    const res = await POST(req('POST', '{"company":"Acme"}'), ctx(['confirm-services']))

    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('refuses path traversal out of the /ai namespace', async () => {
    requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
    const { GET } = await loadRoute()

    const res = await GET(req('GET'), ctx(['..', 'internal']))

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON body with 400 rather than passing it upstream', async () => {
    requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
    const { POST } = await loadRoute()

    const res = await POST(req('POST', 'not json at all'), ctx(['publish']))

    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an oversized body with 413', async () => {
    requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
    const { POST } = await loadRoute()

    const huge = JSON.stringify({ blob: 'x'.repeat(300 * 1024) })
    const res = await POST(req('POST', huge), ctx(['publish']))

    expect(res.status).toBe(413)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // The AI service is a public Render web service with no auth of its own —
  // CORS only stops browser-originated calls, not a direct request to its
  // URL. This shared secret is its only gate against being reached directly,
  // bypassing the admin check above entirely.
  describe('internal shared secret to the AI service', () => {
    const ORIGINAL_SECRET = process.env.AI_SERVICE_SHARED_SECRET

    afterEach(() => {
      if (ORIGINAL_SECRET === undefined) delete process.env.AI_SERVICE_SHARED_SECRET
      else process.env.AI_SERVICE_SHARED_SECRET = ORIGINAL_SECRET
    })

    it('sends X-Internal-Auth to the AI service when configured', async () => {
      process.env.AI_SERVICE_SHARED_SECRET = 'test-internal-secret'
      requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
      const { POST } = await loadRoute()

      await POST(req('POST', '{}'), ctx(['confirm-services']))

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers['X-Internal-Auth']).toBe('test-internal-secret')
    })

    it('omits X-Internal-Auth when unset, so local dev without it keeps working', async () => {
      delete process.env.AI_SERVICE_SHARED_SECRET
      requireAdminFromRequest.mockResolvedValue({ email: 'admin@rolplay.ai', role: 'admin' })
      const { POST } = await loadRoute()

      await POST(req('POST', '{}'), ctx(['confirm-services']))

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers['X-Internal-Auth']).toBeUndefined()
    })
  })
})
