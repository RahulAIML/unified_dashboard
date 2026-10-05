/**
 * Regression: GET /api/ai/known-companies has its own static sibling route
 * (app/api/ai/known-companies/route.ts) that SHOULD take precedence per
 * Next's file-based routing -- but confirmed live in production that it
 * didn't: a POST to that path returned a raw FastAPI "Method Not Allowed"
 * body, proving the request reached ai-service unmodified through THIS
 * catch-all instead (a route with no POST handler would 405 from Next
 * itself, instantly, never reaching ai-service). The Dashboard Builder's
 * company picker was silently missing every pharma/PHP-bridge tenant (only
 * raw rolplay_app_sql rows passed straight through) as a result.
 *
 * This pins the fix: the catch-all's own GET handler now special-cases
 * exactly this one path and returns the real merged list itself, so the
 * picker is correct regardless of which route Next actually resolves to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireAdminFromRequest = vi.fn()
const rateLimit = vi.fn()
const getKnownCompanies = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  requireAdminFromRequest: (...args: unknown[]) => requireAdminFromRequest(...args),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitHeaders: () => ({}),
}))
vi.mock('@/lib/known-companies', () => ({
  getKnownCompanies: (...args: unknown[]) => getKnownCompanies(...args),
}))

const fetchSpy = vi.fn()
const ADMIN = { userId: 1, email: 'admin@rolplay.ai', customerId: 0, role: 'admin' as const }

async function loadRoute() {
  vi.resetModules()
  return import('../route')
}

beforeEach(() => {
  requireAdminFromRequest.mockReset().mockResolvedValue(ADMIN)
  rateLimit.mockReset().mockReturnValue({ ok: true, remaining: 59 })
  getKnownCompanies.mockReset().mockResolvedValue([{ id: 'pharma:heineken', name: 'heineken', sessions: 0, users: 0, source: 'pharma', isNew: false }])
  fetchSpy.mockReset().mockResolvedValue({ status: 200, text: async () => '{}', headers: new Headers({ 'content-type': 'application/json' }) })
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/ai/[...path] — known-companies special case', () => {
  it('returns the real merged picker list for /api/ai/known-companies instead of forwarding to ai-service', async () => {
    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost:3000/api/ai/known-companies')
    const res = await GET(req, { params: Promise.resolve({ path: ['known-companies'] }) })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual([{ id: 'pharma:heineken', name: 'heineken', sessions: 0, users: 0, source: 'pharma', isNew: false }])
    expect(getKnownCompanies).toHaveBeenCalledTimes(1)
    // The whole point: it must NOT have reached ai-service for this path.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still rejects a non-admin for the known-companies special case', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost:3000/api/ai/known-companies')
    const res = await GET(req, { params: Promise.resolve({ path: ['known-companies'] }) })
    expect(res.status).toBe(403)
    expect(getKnownCompanies).not.toHaveBeenCalled()
  })

  it('still forwards every OTHER path to ai-service as before', async () => {
    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost:3000/api/ai/status/job_1')
    const res = await GET(req, { params: Promise.resolve({ path: ['status', 'job_1'] }) })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toContain('/ai/status/job_1')
    expect(getKnownCompanies).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
  })

  it('does not special-case a nested path that merely ends in "known-companies"', async () => {
    const { GET } = await loadRoute()
    const req = new NextRequest('http://localhost:3000/api/ai/foo/known-companies')
    await GET(req, { params: Promise.resolve({ path: ['foo', 'known-companies'] }) })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(getKnownCompanies).not.toHaveBeenCalled()
  })
})
