/**
 * Regression coverage for resolveRolplayAppClientIdAsync's auto-discovery
 * fallback -- the direct fix for "whenever a new client appears in the
 * database it must work automatically, no code change/deploy for it."
 * Found live: armstronglabs.com.mx (476 real users) and procapslatam.com
 * (156 real users) were both missing from BUILTIN_DOMAIN_MAP, locking out
 * every one of their users until someone noticed and shipped a code change.
 * This closes that gap for any FUTURE client the same way, using real
 * r_user data at request time instead of a hand-maintained list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const authQuery = vi.fn()
vi.mock('../db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
}))

const fetchSpy = vi.fn()

async function fresh() {
  vi.resetModules()
  authQuery.mockRejectedValue(new Error('rolplay_app_domains not migrated in this test env'))
  process.env.ROLPLAY_APP_SQL_URL = 'https://sql.test/exec'
  return import('../bridge-rolplay-app')
}

function respond(data: unknown[]) {
  return new Response(JSON.stringify({ result: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ROLPLAY_APP_SQL_URL
})

describe('resolveRolplayAppClientIdAsync — auto-discovery for an unmapped domain', () => {
  it('resolves a brand-new, unambiguous, real domain with no code change', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([{ client_id: 99, n: 250 }]))

    expect(await mod.resolveRolplayAppClientIdAsync('someone@brandnewclient.com')).toBe(99)
  })

  it('never resolves when the domain spans more than one client_id (ambiguous, same reasoning as the hardcoded audioweb.com.mx exclusion)', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([
      { client_id: 13, n: 40 },
      { client_id: 25, n: 12 },
    ]))

    expect(await mod.resolveRolplayAppClientIdAsync('someone@shared-staff-domain.com')).toBeNull()
  })

  it('never resolves a domain with only 1 real user (as likely a typo/test row as a real company)', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([{ client_id: 99, n: 1 }]))

    expect(await mod.resolveRolplayAppClientIdAsync('lonely@onerowcompany.com')).toBeNull()
  })

  it('never queries at all for a known public email provider, even if it would otherwise look single-tenant', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([{ client_id: 99, n: 500 }]))

    expect(await mod.resolveRolplayAppClientIdAsync('someone@gmail.com')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a malformed domain (SQL-injection-shaped) without ever querying, matching the reject-not-escape rule used elsewhere in this file', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([{ client_id: 99, n: 500 }]))

    // email.split('@')[1] on a crafted address hands this function whatever
    // text follows the last '@' -- must never reach the SQL string unchecked.
    expect(await mod.resolveRolplayAppClientIdAsync("x@'; DROP TABLE r_user;--")).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never fabricates a client_id when the live query fails (network error)', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => { throw new Error('network down') })

    expect(await mod.resolveRolplayAppClientIdAsync('someone@brandnewclient.com')).toBeNull()
  })

  it('caches a resolved domain so a second lookup does not re-query the bridge', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([{ client_id: 99, n: 250 }]))

    await mod.resolveRolplayAppClientIdAsync('someone@brandnewclient.com')
    await mod.resolveRolplayAppClientIdAsync('another@brandnewclient.com')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('a pre-existing hardcoded domain never falls through to auto-discovery at all', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([{ client_id: 999, n: 500 }]))

    expect(await mod.resolveRolplayAppClientIdAsync('adriana.losada@siigo.com')).toBe(29)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
