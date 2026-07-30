import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireAdminFromRequest = vi.fn()
const listUsers = vi.fn()
const setUserRole = vi.fn()
const rateLimit = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  requireAdminFromRequest: (...args: unknown[]) => requireAdminFromRequest(...args),
}))
vi.mock('@/lib/db-users', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db-users')>('@/lib/db-users')
  return {
    ...actual,
    listUsers: (...args: unknown[]) => listUsers(...args),
    setUserRole: (...args: unknown[]) => setUserRole(...args),
  }
})
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
}))

async function loadRoute() {
  vi.resetModules()
  return import('../route')
}

const ADMIN = { userId: 1, email: 'admin@rolplay.ai', customerId: 0, role: 'admin' as const }

function getReq() {
  return new NextRequest('http://localhost:3000/api/admin/users')
}
function patchReq(body: string) {
  return new NextRequest('http://localhost:3000/api/admin/users', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
  })
}

beforeEach(() => {
  requireAdminFromRequest.mockReset()
  listUsers.mockReset()
  setUserRole.mockReset()
  rateLimit.mockReset()
  rateLimit.mockReturnValue({ ok: true, remaining: 29, retryAfter: 0, limit: 30 })
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/admin/users', () => {
  it('requires an admin session', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { GET } = await loadRoute()

    const res = await GET(getReq())

    expect(res.status).toBe(403)
    expect(listUsers).not.toHaveBeenCalled()
  })

  it('returns the user list for an admin', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    listUsers.mockResolvedValue([{ id: 1, email: 'a@x.com', role: 'user' }])
    const { GET } = await loadRoute()

    const res = await GET(getReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.users).toHaveLength(1)
  })

  // password_hash exclusion is a contract of listUsers()/rowToSummary(), not
  // this route (listUsers is mocked here, so the route has nothing to
  // filter). That guarantee is proven directly in db-users-role.test.ts.
})

describe('PATCH /api/admin/users', () => {
  it('requires an admin session before touching the database', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"a@x.com","role":"admin"}'))

    expect(res.status).toBe(403)
    expect(setUserRole).not.toHaveBeenCalled()
  })

  it('promotes an existing user to admin', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    setUserRole.mockResolvedValue({ id: 2, email: 'newadmin@x.com', role: 'admin' })
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"newadmin@x.com","role":"admin"}'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(setUserRole).toHaveBeenCalledWith('newadmin@x.com', 'admin')
    expect(body.data.user.role).toBe('admin')
  })

  it('demotes an existing admin to user', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    setUserRole.mockResolvedValue({ id: 2, email: 'other@x.com', role: 'user' })
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"other@x.com","role":"user"}'))

    expect(res.status).toBe(200)
    expect(setUserRole).toHaveBeenCalledWith('other@x.com', 'user')
  })

  it('refuses to let an admin demote themselves', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq(`{"email":"${ADMIN.email}","role":"user"}`))

    expect(res.status).toBe(400)
    expect(setUserRole).not.toHaveBeenCalled()
  })

  it('self-demotion guard is case-insensitive', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"ADMIN@ROLPLAY.AI","role":"user"}'))

    expect(res.status).toBe(400)
    expect(setUserRole).not.toHaveBeenCalled()
  })

  it('still allows an admin to promote themselves to admin (no-op-ish, not blocked)', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    setUserRole.mockResolvedValue({ id: 1, email: ADMIN.email, role: 'admin' })
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq(`{"email":"${ADMIN.email}","role":"admin"}`))

    expect(res.status).toBe(200)
  })

  it('rejects an invalid email', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"not-an-email","role":"admin"}'))

    expect(res.status).toBe(400)
    expect(setUserRole).not.toHaveBeenCalled()
  })

  it('rejects a role that is neither user nor admin', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"a@x.com","role":"superadmin"}'))

    expect(res.status).toBe(400)
    expect(setUserRole).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('not json'))

    expect(res.status).toBe(400)
  })

  it('returns 404 for an email with no active matching user', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    setUserRole.mockResolvedValue(null)
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"ghost@x.com","role":"admin"}'))

    expect(res.status).toBe(404)
  })

  it('is rate limited per admin', async () => {
    requireAdminFromRequest.mockResolvedValue(ADMIN)
    rateLimit.mockReturnValue({ ok: false, remaining: 0, retryAfter: 15, limit: 30 })
    const { PATCH } = await loadRoute()

    const res = await PATCH(patchReq('{"email":"a@x.com","role":"admin"}'))

    expect(res.status).toBe(429)
    expect(setUserRole).not.toHaveBeenCalled()
  })
})
