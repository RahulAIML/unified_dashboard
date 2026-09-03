/**
 * Regression for the incident this fixes: adding `onboarding_completed_at`
 * to every users query broke login/me/register with a 503 on any database
 * where GET /api/auth/setup hadn't been re-run yet (this project's schema
 * "migration" is a manual endpoint call, not automatic -- see
 * app/api/auth/setup/route.ts). authQueryOnboardingSafe must retry once,
 * stripping the column, so those routes keep working exactly as before this
 * feature shipped on any environment that hasn't migrated yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authQuery = vi.fn()

class FakeAuthDbError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
  }
}

vi.mock('../db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
  AuthDbError: FakeAuthDbError,
}))

async function load() {
  vi.resetModules()
  return import('../db-users')
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1, email: 'a@x.com', full_name: 'A', company_domain: 'x.com',
    customer_id: 0, role: 'user', created_at: '2026-01-01T00:00:00Z',
    is_active: true, last_login: null, onboarding_completed_at: null,
    ...over,
  }
}

// lib/db-auth.ts collapses the real Postgres detail (which would have named
// the column) into this exact generic message for every "does not exist"
// case -- so the fallback can only key off `.code`, never message text.
const MISSING_COLUMN_ERROR = new FakeAuthDbError(
  'Auth database schema not initialised. Call GET /api/auth/setup to create tables.',
  'TABLE_MISSING',
)

beforeEach(() => authQuery.mockReset())

describe('findUserByEmail — onboarding column not migrated yet', () => {
  it('retries once without the column and still returns the user', async () => {
    const { findUserByEmail } = await load()
    authQuery
      .mockRejectedValueOnce(MISSING_COLUMN_ERROR)
      .mockResolvedValueOnce([row()])

    const user = await findUserByEmail('a@x.com')

    expect(authQuery).toHaveBeenCalledTimes(2)
    expect(user?.email).toBe('a@x.com')
    expect(user?.onboarding_completed_at).toBeNull()
    const [retrySql] = authQuery.mock.calls[1]
    expect(retrySql).not.toMatch(/onboarding_completed_at/)
  })

  it('does not retry (and rethrows) an unrelated DB error', async () => {
    const { findUserByEmail } = await load()
    const connFailed = new FakeAuthDbError('Cannot connect to the auth database.', 'CONNECTION_FAILED')
    authQuery.mockRejectedValueOnce(connFailed)

    await expect(findUserByEmail('a@x.com')).rejects.toBe(connFailed)
    expect(authQuery).toHaveBeenCalledTimes(1)
  })
})

describe('findUserById — onboarding column not migrated yet', () => {
  it('retries once without the column and still returns the user', async () => {
    const { findUserById } = await load()
    authQuery
      .mockRejectedValueOnce(MISSING_COLUMN_ERROR)
      .mockResolvedValueOnce([row({ id: 42 })])

    const user = await findUserById(42)

    expect(authQuery).toHaveBeenCalledTimes(2)
    expect(user?.id).toBe(42)
    const [retrySql] = authQuery.mock.calls[1]
    expect(retrySql).not.toMatch(/onboarding_completed_at/)
  })
})

describe('createUser — onboarding column not migrated yet', () => {
  it('retries the INSERT...RETURNING without the column', async () => {
    const { createUser } = await load()
    authQuery
      .mockRejectedValueOnce(MISSING_COLUMN_ERROR)
      .mockResolvedValueOnce([row({ email: 'new@x.com' })])

    const user = await createUser('new@x.com', 'hash', 'New User', 'x.com', 0)

    expect(authQuery).toHaveBeenCalledTimes(2)
    expect(user.email).toBe('new@x.com')
    const [retrySql] = authQuery.mock.calls[1]
    expect(retrySql).not.toMatch(/onboarding_completed_at/)
  })
})

describe('promoteFirstAdmin — onboarding column not migrated yet', () => {
  it('retries stripping the qualified target.onboarding_completed_at column', async () => {
    const { promoteFirstAdmin } = await load()
    authQuery
      .mockRejectedValueOnce(MISSING_COLUMN_ERROR)
      .mockResolvedValueOnce([row({ role: 'admin' })])

    const user = await promoteFirstAdmin('a@x.com')

    expect(authQuery).toHaveBeenCalledTimes(2)
    expect(user?.role).toBe('admin')
    const [retrySql] = authQuery.mock.calls[1]
    expect(retrySql).not.toMatch(/onboarding_completed_at/)
  })
})

describe('users table genuinely missing entirely (not just the column)', () => {
  it('retries once, fails identically, and propagates that error (no infinite loop)', async () => {
    const { findUserByEmail } = await load()
    const stillMissing = new FakeAuthDbError(
      'Auth database schema not initialised. Call GET /api/auth/setup to create tables.',
      'TABLE_MISSING',
    )
    authQuery.mockRejectedValueOnce(MISSING_COLUMN_ERROR).mockRejectedValueOnce(stillMissing)

    await expect(findUserByEmail('a@x.com')).rejects.toBe(stillMissing)
    expect(authQuery).toHaveBeenCalledTimes(2)
  })
})

describe('happy path — column already migrated', () => {
  it('returns the real timestamp without any retry', async () => {
    const { findUserByEmail } = await load()
    authQuery.mockResolvedValueOnce([row({ onboarding_completed_at: '2026-09-01T00:00:00.000Z' })])

    const user = await findUserByEmail('a@x.com')

    expect(authQuery).toHaveBeenCalledTimes(1)
    expect(user?.onboarding_completed_at).toBe('2026-09-01T00:00:00.000Z')
  })
})
