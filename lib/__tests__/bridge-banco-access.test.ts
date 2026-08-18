/**
 * Tenant-isolation regression coverage for the Banco half of S1.
 *
 * Registration is open, and banco tenants resolved on email DOMAIN alone, so
 * anyone could sign up as intruder@bancoppel.com and inherit Banco's entire
 * dashboard (headcounts, top performers, recent sessions). resolveBancoAccess
 * adds the roster check that bridge-rolplay-app has always had via r_user.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const query = vi.fn()

vi.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => query(...a),
}))

async function fresh() {
  vi.resetModules()
  process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com,coppel.com'
  return {
    orgType: await import('../org-type'),
    banco: await import('../bridge-banco-analytics'),
  }
}

beforeEach(() => {
  query.mockReset()
})
afterEach(() => {
  delete process.env.BANCO_EMAIL_DOMAINS
})

describe('resolveBancoAccess', () => {
  it('grants a real coach_users member on a banco domain', async () => {
    const { orgType } = await fresh()
    query.mockResolvedValue([{ n: 1 }])

    expect(await orgType.resolveBancoAccess('rep@bancoppel.com')).toBe(true)
  })

  it('DENIES a domain squatter with no coach_users row', async () => {
    const { orgType } = await fresh()
    query.mockResolvedValue([{ n: 0 }])

    // The domain still matches -- that is exactly the trap isBancoOrg falls into.
    expect(orgType.isBancoOrg('intruder@bancoppel.com')).toBe(true)
    // ...but access must not be granted.
    expect(await orgType.resolveBancoAccess('intruder@bancoppel.com')).toBe(false)
  })

  it('never queries the roster for a non-banco domain', async () => {
    const { orgType } = await fresh()

    expect(await orgType.resolveBancoAccess('someone@gmail.com')).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('scopes the roster lookup to configured banco domains', async () => {
    const { orgType } = await fresh()
    query.mockResolvedValue([{ n: 1 }])

    await orgType.resolveBancoAccess('rep@bancoppel.com')

    const [sql, params] = query.mock.calls[0]
    expect(String(sql)).toContain('coach_users')
    // email is normalised, and the domain predicate bindings follow it
    expect(params[0]).toBe('rep@bancoppel.com')
    expect(params.slice(1)).toEqual(['%@bancoppel.com', '%@coppel.com'])
  })
})

describe('bancoUserExists — availability safeguards', () => {
  it('fails OPEN when the roster query errors', async () => {
    const { banco } = await fresh()
    query.mockRejectedValue(new Error('db down'))

    // Failing closed would take the whole Banco dashboard down on a transient outage.
    expect(await banco.bancoUserExists('rep@bancoppel.com')).toBe(true)
  })

  it('fails OPEN rather than hanging when the roster query stalls', async () => {
    const { banco } = await fresh()
    // Never resolves -- simulates an unreachable DB. The 2s internal bound must
    // win, so this must not hang the request path (resolveOrgType calls it on
    // every banco request).
    query.mockImplementation(() => new Promise(() => {}))

    const started = Date.now()
    expect(await banco.bancoUserExists('rep@bancoppel.com')).toBe(true)
    expect(Date.now() - started).toBeLessThan(4_000)
  }, 10_000)

  it('caches a successful lookup instead of querying per request', async () => {
    const { banco } = await fresh()
    query.mockResolvedValue([{ n: 1 }])

    await banco.bancoUserExists('rep@bancoppel.com')
    await banco.bancoUserExists('rep@bancoppel.com')

    expect(query).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failure, so it self-heals', async () => {
    const { banco } = await fresh()
    query.mockRejectedValueOnce(new Error('blip'))
    query.mockResolvedValue([{ n: 0 }])

    expect(await banco.bancoUserExists('intruder@bancoppel.com')).toBe(true) // allowed through the error
    expect(await banco.bancoUserExists('intruder@bancoppel.com')).toBe(false) // now correctly denied
  })

  it('denies everyone when no banco domains are configured, without querying', async () => {
    vi.resetModules()
    delete process.env.BANCO_EMAIL_DOMAINS
    const banco = await import('../bridge-banco-analytics')

    expect(await banco.bancoUserExists('rep@bancoppel.com')).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })
})
