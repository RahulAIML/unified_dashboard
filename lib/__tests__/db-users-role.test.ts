/**
 * listUsers / setUserRole — the DB layer behind /api/admin/users.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authQuery = vi.fn()
vi.mock('../db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
  AuthDbError: class extends Error {},
}))

async function load() {
  vi.resetModules()
  return import('../db-users')
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1, email: 'a@x.com', full_name: 'A', company_domain: 'x.com',
    customer_id: 0, role: 'user', created_at: '2026-01-01T00:00:00Z',
    is_active: true, last_login: null,
    ...over,
  }
}

beforeEach(() => authQuery.mockReset())

describe('listUsers', () => {
  it('maps rows to summaries without exposing password_hash', async () => {
    const { listUsers } = await load()
    authQuery.mockResolvedValue([row({ password_hash: 'secret-hash-should-not-leak' })])

    const users = await listUsers()

    expect(users).toHaveLength(1)
    expect(users[0]).not.toHaveProperty('password_hash')
    expect(JSON.stringify(users)).not.toContain('secret-hash-should-not-leak')
  })

  it('orders newest first', async () => {
    const { listUsers } = await load()
    authQuery.mockResolvedValue([])
    await listUsers()

    const [sql] = authQuery.mock.calls[0]
    expect(sql).toMatch(/ORDER BY created_at DESC/)
  })

  it('normalises timestamp fields to ISO strings', async () => {
    const { listUsers } = await load()
    authQuery.mockResolvedValue([row({ created_at: new Date('2026-02-01T00:00:00Z'), last_login: new Date('2026-02-02T00:00:00Z') })])

    const [u] = await listUsers()

    expect(u.created_at).toBe('2026-02-01T00:00:00.000Z')
    expect(u.last_login).toBe('2026-02-02T00:00:00.000Z')
  })
})

describe('setUserRole', () => {
  it('promotes a user and lowercases/trims the email', async () => {
    const { setUserRole } = await load()
    authQuery.mockResolvedValue([row({ email: 'b@x.com', role: 'admin' })])

    const updated = await setUserRole('  B@X.com  ', 'admin')

    expect(updated?.role).toBe('admin')
    const [, params] = authQuery.mock.calls[0]
    expect(params[0]).toBe('b@x.com')
    expect(params[1]).toBe('admin')
  })

  it('returns null when no active user matches', async () => {
    const { setUserRole } = await load()
    authQuery.mockResolvedValue([])

    expect(await setUserRole('ghost@x.com', 'admin')).toBeNull()
  })

  it('only targets active users in its WHERE clause', async () => {
    const { setUserRole } = await load()
    authQuery.mockResolvedValue([])
    await setUserRole('a@x.com', 'user')

    const [sql] = authQuery.mock.calls[0]
    expect(sql).toMatch(/is_active\s*=\s*TRUE/)
  })
})
