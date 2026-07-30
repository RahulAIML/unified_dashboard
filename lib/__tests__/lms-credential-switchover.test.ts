/**
 * The switchover's contract: LMS credentials resolve from the runtime store
 * WITHOUT any environment variable, and without the tenant key needing to match
 * an env var name.
 *
 * That last part is the whole point. Apotex's tab stayed hidden because its
 * DB-assigned tenant key did not match `LMS_APOTEX_*`. These tests assert the
 * failure mode is gone rather than merely documented: a tenant keyed
 * 'apotex_mexico_2024' resolves fine with nothing in the environment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const authQuery = vi.fn()
vi.mock('../db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
  AuthDbError: class extends Error {},
}))

const KEY = Buffer.alloc(32, 11).toString('base64')

async function fresh() {
  vi.resetModules()
  process.env.SECRET_ENCRYPTION_KEY = KEY
  const crypto = await import('../secret-crypto')
  const creds = await import('../tenant-credentials')
  creds.__resetCredentialCache()
  const lms = await import('../lms-learnworlds')
  return { ...crypto, ...creds, ...lms }
}

/** Every LMS_* var removed, so nothing can pass by accident via env. */
function clearLmsEnv() {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LMS_')) delete process.env[k]
  }
}

beforeEach(() => {
  authQuery.mockReset()
  authQuery.mockResolvedValue([])
  clearLmsEnv()
  process.env.SECRET_ENCRYPTION_KEY = KEY
})
afterEach(clearLmsEnv)

describe('resolveLmsCredentialsAsync — DB only, no env', () => {
  it('resolves entirely from the credential store', async () => {
    const { resolveLmsCredentialsAsync, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://apotex.learnworlds.com') },
      { field: 'client_id', value_encrypted: encryptSecret('cid-db') },
      { field: 'client_secret', value_encrypted: encryptSecret('secret-db') },
    ])

    const creds = await resolveLmsCredentialsAsync('apotex')

    expect(creds).not.toBeNull()
    expect(creds!.origin).toBe('https://apotex.learnworlds.com')
    expect(creds!.clientId).toBe('cid-db')
  })

  it('works for a tenant key that no env var could ever match', async () => {
    const { resolveLmsCredentialsAsync, encryptSecret } = await fresh()
    // The Apotex-on-Render case: a DB-generated key. Under the old scheme this
    // needed LMS_APOTEX_MEXICO_2024_* to exist, which nobody would guess.
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://school.learnworlds.com') },
      { field: 'access_token', value_encrypted: encryptSecret('tok') },
    ])

    const creds = await resolveLmsCredentialsAsync('apotex_mexico_2024')

    expect(creds).not.toBeNull()
    expect(creds!.accessToken).toBe('tok')
  })

  it('accepts a stored token alone, without the client pair', async () => {
    const { resolveLmsCredentialsAsync, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://s.learnworlds.com') },
      { field: 'access_token', value_encrypted: encryptSecret('tok-only') },
    ])

    expect(await resolveLmsCredentialsAsync('t')).not.toBeNull()
  })

  it('returns null when the URL is stored but no auth is', async () => {
    const { resolveLmsCredentialsAsync, encryptSecret } = await fresh()
    // Half-configured must not read as configured — the tab would open onto an
    // empty state that looks like an outage.
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://s.learnworlds.com') },
    ])

    expect(await resolveLmsCredentialsAsync('t')).toBeNull()
  })

  it('reduces a pasted admin path to the origin', async () => {
    const { resolveLmsCredentialsAsync, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://s.learnworlds.com/admin/api/') },
      { field: 'access_token', value_encrypted: encryptSecret('tok') },
    ])

    const creds = await resolveLmsCredentialsAsync('t')

    // Otherwise requests become /admin/api/admin/api/v2.
    expect(creds!.origin).toBe('https://s.learnworlds.com')
  })
})

describe('backward compatibility', () => {
  it('still resolves a tenant configured only by env vars', async () => {
    const { resolveLmsCredentialsAsync } = await fresh()
    // No DB rows at all — the existing-tenant path must be untouched.
    authQuery.mockResolvedValue([])
    process.env.LMS_SANFER_API_URL = 'https://sanfer.learnworlds.com'
    process.env.LMS_SANFER_ACCESS_TOKEN = 'env-tok'

    const creds = await resolveLmsCredentialsAsync('sanfer')

    expect(creds!.origin).toBe('https://sanfer.learnworlds.com')
    expect(creds!.accessToken).toBe('env-tok')
  })

  it('survives the DB being unreachable, falling back to env', async () => {
    const { resolveLmsCredentialsAsync } = await fresh()
    authQuery.mockRejectedValue(new Error('ECONNREFUSED'))
    process.env.LMS_SANFER_API_URL = 'https://sanfer.learnworlds.com'
    process.env.LMS_SANFER_ACCESS_TOKEN = 'env-tok'

    // A Postgres outage must not take the LMS offline for env-configured tenants.
    expect(await resolveLmsCredentialsAsync('sanfer')).not.toBeNull()
  })

  it('returns null for a tenant with nothing anywhere', async () => {
    const { resolveLmsCredentialsAsync } = await fresh()
    expect(await resolveLmsCredentialsAsync('unknown-tenant')).toBeNull()
  })
})

describe('tenant isolation holds after the switchover', () => {
  it('does not give a named tenant the shared env credentials', async () => {
    const { resolveLmsCredentialsAsync } = await fresh()
    process.env.LMS_API_URL = 'https://shared.learnworlds.com'
    process.env.LMS_ACCESS_TOKEN = 'shared-tok'

    // The leak guard must survive the move to DB-first resolution.
    expect(await resolveLmsCredentialsAsync('apotex')).toBeNull()
  })

  it('hasLmsCredentialsAsync agrees with resolve, so tab and data cannot diverge', async () => {
    const { hasLmsCredentialsAsync, resolveLmsCredentialsAsync, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://s.learnworlds.com') },
      { field: 'access_token', value_encrypted: encryptSecret('tok') },
    ])

    expect(await hasLmsCredentialsAsync('t')).toBe(true)
    expect(await resolveLmsCredentialsAsync('t')).not.toBeNull()

    authQuery.mockResolvedValue([])
    const { __resetCredentialCache } = await import('../tenant-credentials')
    __resetCredentialCache()

    expect(await hasLmsCredentialsAsync('none')).toBe(false)
  })
})
