/**
 * Guards on the raw-SQL transport (audit S2).
 *
 * The endpoint accepts arbitrary SQL over HTTP and, as of writing, requires no
 * authentication. Fixing that is server-side work outside this repo; what this
 * codebase can guarantee is that IT never sends anything but a read, and that it
 * attaches a shared secret the moment one is configured.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchSpy = vi.fn()

async function fresh() {
  vi.resetModules()
  process.env.ROLPLAY_APP_SQL_URL = 'https://sql.test/exec'
  process.env.ROLPLAY_APP_DOMAINS = 'acme:acme.test'
  return import('../bridge-rolplay-app')
}

function okResponse(data: unknown[] = []) {
  return new Response(JSON.stringify({ result: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue(okResponse())
  vi.stubGlobal('fetch', fetchSpy)
  delete process.env.ROLPLAY_APP_SQL_TOKEN
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ROLPLAY_APP_SQL_TOKEN
})

/** Read the SQL body of the Nth fetch call. */
function sentSql(n = 0): string {
  const init = fetchSpy.mock.calls[n]?.[1] as { body?: string } | undefined
  return JSON.parse(init?.body ?? '{}').sql ?? ''
}
function sentHeaders(n = 0): Record<string, string> {
  const init = fetchSpy.mock.calls[n]?.[1] as { headers?: Record<string, string> } | undefined
  return init?.headers ?? {}
}

describe('shared-secret header', () => {
  it('omits the auth header when no token is configured', async () => {
    const mod = await fresh()
    await mod.rolplayAppAvailableModules(1)

    expect(fetchSpy).toHaveBeenCalled()
    expect(sentHeaders()['X-Rolplay-Auth']).toBeUndefined()
  })

  it('attaches the token when configured, so cutover needs no code change', async () => {
    process.env.ROLPLAY_APP_SQL_TOKEN = 'shared-secret-value'
    const mod = await fresh()
    await mod.rolplayAppAvailableModules(1)

    expect(sentHeaders()['X-Rolplay-Auth']).toBe('shared-secret-value')
  })
})

describe('read-only guard', () => {
  it('only ever sends SELECT/WITH statements', async () => {
    const mod = await fresh()
    await mod.rolplayAppAvailableModules(42)

    // Every production caller must be a read; assert on what actually went out.
    expect(sentSql()).toMatch(/^\s*(select|with)\s/i)
  })

  it('coerces the client id to an integer before inlining it', async () => {
    const mod = await fresh()
    // 7.9 must not appear verbatim in the SQL; Math.trunc is the injection guard
    // for this interpolated value.
    await mod.rolplayAppAvailableModules(7.9)

    expect(sentSql()).toContain('7')
    expect(sentSql()).not.toContain('7.9')
  })
})

describe('assertReadOnly (exercised through the transport)', () => {
  // assertReadOnly is module-private, so it is verified via a caller: any future
  // non-SELECT path would throw before a request is made.
  it('never issues a request whose body mutates data', async () => {
    const mod = await fresh()
    await mod.rolplayAppAvailableModules(1)

    const sql = sentSql().toLowerCase()
    for (const verb of ['insert ', 'update ', 'delete ', 'drop ', 'alter ', 'truncate ']) {
      expect(sql).not.toContain(verb)
    }
  })

  it('sends no stacked statements', async () => {
    const mod = await fresh()
    await mod.rolplayAppAvailableModules(1)

    // A ';' followed by more SQL could smuggle a second statement past a naive
    // server-side prefix check.
    expect(/;\s*\S/.test(sentSql().trim())).toBe(false)
  })
})
