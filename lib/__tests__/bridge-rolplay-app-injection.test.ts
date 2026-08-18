/**
 * Regression coverage: rolplayAppUserExists (the r_user membership check
 * behind resolveRolplayAppAccess) used to escape a quote character in the
 * caller-supplied email with `.replace(/'/g, "''")` before inlining it into a
 * raw SQL string sent to remoteSelect -- the classic unsafe pattern, not a
 * whitelist, and this endpoint has no parameterization to fall back on.
 *
 * This is reachable by a real attacker, not just theoretical: registration's
 * own validateEmail() (lib/password.ts) has no denylist on quote/backslash
 * characters -- `a'or'1'='1@example.com` passes it -- and rolplayAppUserExists
 * is the exact function deciding tenant-membership ACCESS (the check added
 * for S1 in docs/PRODUCTION_READINESS_AUDIT.md). A working injection here
 * would let an attacker forge membership in any client_id, defeating S1
 * entirely rather than just leaking rows.
 *
 * The fix rejects (denies access) rather than escapes: a real email has no
 * operational need for a quote or backslash character.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchSpy = vi.fn()

async function fresh() {
  vi.resetModules()
  process.env.ROLPLAY_APP_SQL_URL = 'https://sql.test/exec'
  process.env.ROLPLAY_APP_DOMAINS = 'siigo.com:29'
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
  delete process.env.ROLPLAY_APP_DOMAINS
})

describe('rolplayAppUserExists (via resolveRolplayAppAccess) — injection hardening', () => {
  it('denies access for an email containing a single quote, without ever querying the bridge', async () => {
    const mod = await fresh()
    // If the vulnerable path ran, this response would make the (broken) COUNT
    // query return a match -- proving the fix works even if the malicious SQL
    // would have "succeeded". fetchSpy should never even be called.
    fetchSpy.mockResolvedValue(respond([{ n: 999 }]))

    const result = await mod.resolveRolplayAppAccess("a'or'1'='1@siigo.com")

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('denies access for an email containing a backslash', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([{ n: 999 }]))

    const withBackslash = 'a' + String.fromCharCode(92) + 'b@siigo.com'
    const result = await mod.resolveRolplayAppAccess(withBackslash)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still grants a real member with a normal email (no false-positive rejection)', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([{ n: 1 }]))

    const result = await mod.resolveRolplayAppAccess('adriana.losada@siigo.com')

    expect(result).toBe(29)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("sends the email unescaped-but-clean in the query for a normal address (no '' doubling artifact)", async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([{ n: 1 }]))

    await mod.resolveRolplayAppAccess('adriana.losada@siigo.com')

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as { body: string }).body)
    expect(body.sql).toContain("'adriana.losada@siigo.com'")
    expect(body.sql).not.toContain("''")
  })
})
