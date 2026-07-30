import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const promoteFirstAdmin = vi.fn()
const rateLimit = vi.fn()

vi.mock('@/lib/db-users', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db-users')>('@/lib/db-users')
  return { ...actual, promoteFirstAdmin: (...args: unknown[]) => promoteFirstAdmin(...args) }
})
vi.mock('@/lib/rate-limit', () => ({
  clientKey: () => 'bootstrap-admin:test',
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}))

async function loadRoute() {
  vi.resetModules()
  return import('../bootstrap-admin/route')
}

function request(body: string, secret?: string) {
  return new NextRequest('http://localhost:3000/api/auth/bootstrap-admin', {
    method: 'POST',
    headers: secret ? { 'content-type': 'application/json', 'x-setup-secret': secret } : { 'content-type': 'application/json' },
    body,
  })
}

beforeEach(() => {
  process.env.SETUP_SECRET = 'test-bootstrap-secret'
  promoteFirstAdmin.mockReset()
  rateLimit.mockReset()
  rateLimit.mockReturnValue({ ok: true, remaining: 4, retryAfter: 0, limit: 5 })
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/auth/bootstrap-admin', () => {
  it('refuses a missing or invalid setup secret before touching the database', async () => {
    const { POST } = await loadRoute()
    const response = await POST(request('{"email":"admin@example.com"}'))

    expect(response.status).toBe(401)
    expect(promoteFirstAdmin).not.toHaveBeenCalled()
  })

  it('promotes one existing account with the header secret', async () => {
    promoteFirstAdmin.mockResolvedValue({ id: 7, email: 'admin@example.com', role: 'admin' })
    const { POST } = await loadRoute()
    const response = await POST(request('{"email":"ADMIN@EXAMPLE.COM"}', 'test-bootstrap-secret'))

    expect(response.status).toBe(200)
    expect(promoteFirstAdmin).toHaveBeenCalledWith('admin@example.com')
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { user: { role: 'admin' } } })
  })

  it('rejects malformed input', async () => {
    const { POST } = await loadRoute()
    const response = await POST(request('{"email":"not-an-email"}', 'test-bootstrap-secret'))

    expect(response.status).toBe(400)
    expect(promoteFirstAdmin).not.toHaveBeenCalled()
  })

  it('cannot promote a second account after bootstrap is closed', async () => {
    promoteFirstAdmin.mockResolvedValue(null)
    const { POST } = await loadRoute()
    const response = await POST(request('{"email":"admin@example.com"}', 'test-bootstrap-secret'))

    expect(response.status).toBe(409)
  })

  it('rate limits setup-secret guessing', async () => {
    rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfter: 30, limit: 5 })
    const { POST } = await loadRoute()
    const response = await POST(request('{"email":"admin@example.com"}', 'test-bootstrap-secret'))

    expect(response.status).toBe(429)
    expect(promoteFirstAdmin).not.toHaveBeenCalled()
  })
})
