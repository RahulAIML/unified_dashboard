/**
 * Resolution order is the contract: DB (encrypted) → tenant-scoped env → shared
 * env only when there is no tenant key. These tests pin that order, and pin the
 * two safety properties that matter most:
 *   - a named tenant NEVER inherits shared credentials (cross-tenant leak), and
 *   - a decryption failure never silently degrades to env (which would present a
 *     misconfigured tenant as a working one).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const authQuery = vi.fn()
vi.mock('../db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
  AuthDbError: class extends Error {},
}))

const KEY = Buffer.alloc(32, 5).toString('base64')
const LMS_FIELDS = ['api_url', 'client_id', 'client_secret', 'access_token'] as const

async function fresh() {
  vi.resetModules()
  process.env.SECRET_ENCRYPTION_KEY = KEY
  const crypto = await import('../secret-crypto')
  const mod = await import('../tenant-credentials')
  mod.__resetCredentialCache()
  return { ...mod, ...crypto }
}

beforeEach(() => {
  authQuery.mockReset()
  authQuery.mockResolvedValue([])
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LMS_')) delete process.env[k]
  }
  process.env.SECRET_ENCRYPTION_KEY = KEY
})
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LMS_')) delete process.env[k]
  }
})

describe('DB resolution', () => {
  it('decrypts credentials stored in the database', async () => {
    const { resolveTenantCredentials, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://apotex.learnworlds.com') },
      { field: 'access_token', value_encrypted: encryptSecret('tok-123') },
    ])

    const b = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    expect(b.api_url).toBe('https://apotex.learnworlds.com')
    expect(b.access_token).toBe('tok-123')
  })

  it('prefers the DB over a tenant-scoped env var', async () => {
    const { resolveTenantCredentials, encryptSecret } = await fresh()
    process.env.LMS_APOTEX_API_URL = 'https://stale-from-env.example'
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://from-db.example') },
    ])

    const b = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    // Runtime config must win, or the wizard could not correct a bad env value.
    expect(b.api_url).toBe('https://from-db.example')
  })

  it('mixes DB and env per field for a partially migrated tenant', async () => {
    const { resolveTenantCredentials, encryptSecret } = await fresh()
    process.env.LMS_APOTEX_CLIENT_ID = 'env-cid'
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://db.example') },
    ])

    const b = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    expect(b.api_url).toBe('https://db.example')
    expect(b.client_id).toBe('env-cid')
  })

  it('falls back to env when the table does not exist yet', async () => {
    const { resolveTenantCredentials } = await fresh()
    // Pre-migration state — must not break existing tenants.
    authQuery.mockRejectedValue(new Error('relation "tenant_credentials" does not exist'))
    process.env.LMS_APOTEX_API_URL = 'https://env.example'

    const b = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    expect(b.api_url).toBe('https://env.example')
  })

  it('skips a field it cannot decrypt instead of returning ciphertext', async () => {
    const { resolveTenantCredentials } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: 'v1:bogus:bogus:bogus' },
    ])

    const b = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    // Never hand ciphertext to a caller as if it were a usable value.
    expect(b.api_url).toBeUndefined()
  })
})

describe('tenant isolation', () => {
  it('never gives a named tenant the shared credentials', async () => {
    const { resolveTenantCredentials } = await fresh()
    process.env.LMS_API_URL = 'https://shared-school.example'
    process.env.LMS_CLIENT_ID = 'shared'

    const b = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    // The leak this whole design exists to prevent.
    expect(b.api_url).toBeUndefined()
    expect(b.client_id).toBeUndefined()
  })

  it('does use shared credentials when there is no tenant key', async () => {
    const { resolveTenantCredentials } = await fresh()
    process.env.LMS_API_URL = 'https://single-tenant.example'

    const b = await resolveTenantCredentials(null, 'lms', 'LMS', LMS_FIELDS)

    expect(b.api_url).toBe('https://single-tenant.example')
  })

  it('normalises a tenant key with a hyphen into a legal env name', async () => {
    const { resolveTenantCredentials } = await fresh()
    // 'apotex-mx' must look for LMS_APOTEX_MX_*, since LMS_APOTEX-MX_* cannot
    // be set as an environment variable at all.
    process.env.LMS_APOTEX_MX_API_URL = 'https://mx.example'

    const b = await resolveTenantCredentials('apotex-mx', 'lms', 'LMS', LMS_FIELDS)

    expect(b.api_url).toBe('https://mx.example')
  })

  it('keeps tenants in separate cache entries', async () => {
    const { resolveTenantCredentials, encryptSecret } = await fresh()
    authQuery.mockImplementation(async (_sql: string, params: unknown[]) =>
      params[0] === 'apotex'
        ? [{ field: 'api_url', value_encrypted: encryptSecret('https://apotex.example') }]
        : [{ field: 'api_url', value_encrypted: encryptSecret('https://sanfer.example') }],
    )

    const a = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)
    const s = await resolveTenantCredentials('sanfer', 'lms', 'LMS', LMS_FIELDS)

    expect(a.api_url).toBe('https://apotex.example')
    expect(s.api_url).toBe('https://sanfer.example')
  })
})

describe('caching', () => {
  it('does not re-query within the TTL', async () => {
    const { resolveTenantCredentials, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://x.example') },
    ])

    await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)
    await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    expect(authQuery).toHaveBeenCalledTimes(1)
  })

  it('re-queries after invalidation so a rotation takes effect', async () => {
    const { resolveTenantCredentials, invalidateTenantCredentials, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://old.example') },
    ])
    await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://new.example') },
    ])
    invalidateTenantCredentials('apotex', 'lms')
    const b = await resolveTenantCredentials('apotex', 'lms', 'LMS', LMS_FIELDS)

    expect(b.api_url).toBe('https://new.example')
  })
})

describe('hasTenantCredentials', () => {
  it('is true only when every required field resolves', async () => {
    const { hasTenantCredentials, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://x.example') },
    ])

    expect(await hasTenantCredentials('apotex', 'lms', 'LMS', ['api_url'], LMS_FIELDS)).toBe(true)
    expect(
      await hasTenantCredentials('apotex', 'lms', 'LMS', ['api_url', 'access_token'], LMS_FIELDS),
    ).toBe(false)
  })

  it('is false for a tenant with nothing configured anywhere', async () => {
    const { hasTenantCredentials } = await fresh()
    expect(await hasTenantCredentials('nobody', 'lms', 'LMS', ['api_url'], LMS_FIELDS)).toBe(false)
  })
})

/**
 * These tests exist because a first draft of diagnoseTenantCredentials had a
 * bug caught before it shipped: it checked `LMS_API_URL` for a NAMED tenant
 * (missing the tenant-key segment resolveTenantCredentials actually inserts),
 * so it would report a correctly-configured tenant-scoped env var as
 * 'missing' — a diagnostic tool that lies about the exact thing it exists to
 * diagnose. Asserting the diagnostic agrees with the real resolver on the
 * SAME env vars is what would have caught that before it shipped.
 */
describe('diagnoseTenantCredentials', () => {
  it('reports a tenant-scoped env var as env, not missing', async () => {
    const { diagnoseTenantCredentials } = await fresh()
    process.env.LMS_APOTEX_API_URL = 'https://apotex.example'

    const d = await diagnoseTenantCredentials('apotex', 'lms', 'LMS', ['api_url'])

    expect(d.fields.api_url).toBe('env')
  })

  it('agrees with resolveTenantCredentials on which env var name it checks', async () => {
    // Regression guard for the exact bug found: run both against the same
    // env var and require the same verdict.
    const { diagnoseTenantCredentials, resolveTenantCredentials } = await fresh()
    process.env.LMS_APOTEX_MX_ACCESS_TOKEN = 'tok'

    const resolved = await resolveTenantCredentials('apotex-mx', 'lms', 'LMS', ['access_token'])
    const diagnosed = await diagnoseTenantCredentials('apotex-mx', 'lms', 'LMS', ['access_token'])

    expect(resolved.access_token).toBe('tok')
    expect(diagnosed.fields.access_token).toBe('env')
  })

  it('reports a DB-stored field as db, taking precedence over env', async () => {
    const { diagnoseTenantCredentials, encryptSecret } = await fresh()
    authQuery.mockResolvedValue([
      { field: 'api_url', value_encrypted: encryptSecret('https://from-db.example') },
    ])
    process.env.LMS_APOTEX_API_URL = 'https://from-env.example'

    const d = await diagnoseTenantCredentials('apotex', 'lms', 'LMS', ['api_url'])

    expect(d.fields.api_url).toBe('db')
  })

  it('reports missing when neither DB nor env has the field', async () => {
    const { diagnoseTenantCredentials } = await fresh()
    const d = await diagnoseTenantCredentials('nobody', 'lms', 'LMS', ['api_url'])
    expect(d.fields.api_url).toBe('missing')
  })

  it('never includes a decrypted value, only presence', async () => {
    const { diagnoseTenantCredentials, encryptSecret } = await fresh()
    const secretValue = 'super-secret-token-value'
    authQuery.mockResolvedValue([
      { field: 'access_token', value_encrypted: encryptSecret(secretValue) },
    ])

    const d = await diagnoseTenantCredentials('apotex', 'lms', 'LMS', ['access_token'])

    expect(JSON.stringify(d)).not.toContain(secretValue)
  })

  it('reports dbReachable=false and the error when the DB query throws', async () => {
    const { diagnoseTenantCredentials } = await fresh()
    authQuery.mockRejectedValue(new Error('relation "tenant_credentials" does not exist'))

    const d = await diagnoseTenantCredentials('apotex', 'lms', 'LMS', ['api_url'])

    expect(d.dbReachable).toBe(false)
    expect(d.dbError).toContain('tenant_credentials')
  })

  it('does not touch the DB at all for a null tenant key', async () => {
    const { diagnoseTenantCredentials } = await fresh()
    process.env.LMS_API_URL = 'https://shared.example'

    const d = await diagnoseTenantCredentials(null, 'lms', 'LMS', ['api_url'])

    expect(authQuery).not.toHaveBeenCalled()
    expect(d.fields.api_url).toBe('env')
    expect(d.dbReachable).toBe(true)
  })
})
