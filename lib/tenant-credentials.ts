/**
 * lib/tenant-credentials.ts — runtime credential resolution.
 *
 * Resolution order, and why:
 *   1. tenant_credentials (encrypted, DB)  ← added at runtime, no redeploy
 *   2. LMS_<TENANT>_* / <PROVIDER>_<TENANT>_* environment variables
 *   3. shared <PROVIDER>_* environment variables (only when no tenant key)
 *
 * DB first so a tenant onboarded through the wizard works immediately. Env
 * fallback retained so every EXISTING tenant keeps working with no migration
 * and no coordinated cutover — this is what makes the change additive. A tenant
 * is migrated by inserting rows; the env vars can be removed later, per tenant,
 * once verified.
 *
 * Failure philosophy: a DB or decryption problem must NEVER silently fall back
 * to env, because that would mask a misconfigured tenant as a working one and
 * could serve the WRONG tenant's credentials. Errors are logged loudly and the
 * lookup returns null for that field.
 */
import { decryptSecret, isSecretCryptoConfigured, SecretCryptoError } from './secret-crypto'

export type CredentialProvider = 'lms' | 'bridge' | 'second_brain'

/** Field name → resolved plaintext. Only fields that exist are present. */
export type CredentialBundle = Record<string, string>

interface CacheEntry {
  bundle: CredentialBundle
  loadedAt: number
}

/**
 * In-process cache. Same per-instance limitation as lib/rate-limit.ts and
 * lib/pharma-tenant.ts; all three move to Redis together in Phase 2/6. Kept
 * short so a credential rotation takes effect quickly without a restart.
 */
const CACHE_TTL_MS = 30_000
const cache = new Map<string, CacheEntry>()

function cacheKey(tenantKey: string | null, provider: CredentialProvider): string {
  return `${provider}:${tenantKey ?? '(shared)'}`
}

/** Clear cached credentials. Call after any admin write. */
export function invalidateTenantCredentials(
  tenantKey?: string | null,
  provider?: CredentialProvider,
): void {
  if (tenantKey === undefined && provider === undefined) {
    cache.clear()
    return
  }
  if (tenantKey !== undefined && provider !== undefined) {
    cache.delete(cacheKey(tenantKey, provider))
    return
  }
  // Partial invalidation: drop anything matching whichever part was given.
  for (const key of [...cache.keys()]) {
    const [p, t] = key.split(':')
    if (provider !== undefined && p !== provider) continue
    if (tenantKey !== undefined && t !== (tenantKey ?? '(shared)')) continue
    cache.delete(key)
  }
}

/**
 * Read a tenant's credentials for one provider from the DB.
 *
 * Returns an empty bundle when the table is absent, the tenant has no rows, or
 * the DB is unreachable — all of which are legitimate states meaning "fall back
 * to env". Distinguished from a DECRYPTION failure, which is a real
 * misconfiguration and is surfaced, not swallowed.
 */
async function readFromDb(
  tenantKey: string,
  provider: CredentialProvider,
): Promise<CredentialBundle> {
  if (!isSecretCryptoConfigured()) return {}

  let rows: { field: string; value_encrypted: string }[]
  try {
    // authQuery, NOT lib/db.ts's query(): db.ts is the MySQL analytics pool,
    // while tenant_credentials lives in the Auth POSTGRES database next to
    // pharma_tenants. Using the wrong one would fail at runtime only, on the
    // request path. Imported lazily so a missing DATABASE_URL cannot break the
    // env-only path.
    const { authQuery } = await import('./db-auth')
    rows = await authQuery<{ field: string; value_encrypted: string }>(
      `SELECT field, value_encrypted
         FROM tenant_credentials
        WHERE tenant_key = $1 AND provider = $2 AND is_active
        ORDER BY field`,
      [tenantKey, provider],
    )
  } catch {
    // No table yet (pre-migration), no DB configured, or transient outage.
    // Silent by design: this is the expected state for every tenant that has
    // not been migrated, and logging it per request would be pure noise.
    return {}
  }

  const bundle: CredentialBundle = {}
  for (const row of rows) {
    try {
      bundle[row.field] = decryptSecret(row.value_encrypted)
    } catch (err) {
      // LOUD: a stored credential that cannot be decrypted means the master key
      // changed or the row is corrupt. Skipping the field quietly would present
      // a broken tenant as merely unconfigured.
      console.error(
        `[tenant-credentials] DECRYPT FAILED tenant=${tenantKey} provider=${provider} ` +
        `field=${row.field}: ${err instanceof SecretCryptoError ? err.message : String(err)}`,
      )
    }
  }
  return bundle
}

/**
 * The exact env var name resolveTenantCredentials will look for. Factored out
 * as the SINGLE source of truth for this naming, because a second, hand-copied
 * version of this logic in diagnoseTenantCredentials previously drifted from
 * this one and silently reported every tenant-scoped var as missing — a
 * diagnostic that lies is worse than no diagnostic. Both now call this.
 */
function tenantEnvVarName(tenantKey: string, envPrefix: string, suffix: string): string {
  // Non-alphanumerics collapse to '_' — a key like 'apotex-mx' would
  // otherwise build an env name that cannot legally be set.
  const scoped = tenantKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return `${envPrefix}_${scoped}_${suffix}`
}

/**
 * Resolve a tenant's credential bundle for one provider, DB first then env.
 *
 * @param envPrefix uppercase provider prefix for env fallback, e.g. 'LMS'.
 * @param fields    field names to look for, e.g. ['api_url','client_id'].
 */
export async function resolveTenantCredentials(
  tenantKey: string | null,
  provider: CredentialProvider,
  envPrefix: string,
  fields: readonly string[],
): Promise<CredentialBundle> {
  const key = cacheKey(tenantKey, provider)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.bundle

  const bundle: CredentialBundle = tenantKey ? await readFromDb(tenantKey, provider) : {}

  // Env fallback, per field, so a partially migrated tenant still resolves:
  // fields present in the DB win, the rest come from env.
  for (const field of fields) {
    if (bundle[field]) continue
    const suffix = field.toUpperCase()
    if (tenantKey) {
      const v = process.env[tenantEnvVarName(tenantKey, envPrefix, suffix)]
      if (v) { bundle[field] = v; continue }
      // Deliberately NO shared fallback for a named tenant: a bare LMS_* would
      // otherwise serve one school's data to every tenant.
      continue
    }
    const shared = process.env[`${envPrefix}_${suffix}`]
    if (shared) bundle[field] = shared
  }

  cache.set(key, { bundle, loadedAt: Date.now() })
  return bundle
}

/** Whether a tenant has credentials from ANY source. Cheap capability probe. */
export async function hasTenantCredentials(
  tenantKey: string | null,
  provider: CredentialProvider,
  envPrefix: string,
  requiredFields: readonly string[],
  allFields: readonly string[],
): Promise<boolean> {
  const bundle = await resolveTenantCredentials(tenantKey, provider, envPrefix, allFields)
  return requiredFields.every(f => Boolean(bundle[f]))
}

/** Test-only. */
export function __resetCredentialCache(): void {
  cache.clear()
}

export interface CredentialDiagnostic {
  tenantKey: string | null
  provider: CredentialProvider
  envPrefix: string
  /** Per requested field: where it resolved from, or 'missing'. NEVER the value. */
  fields: Record<string, 'db' | 'env' | 'missing'>
  dbReachable: boolean
  /** Present only when dbReachable is false — the DB error message. */
  dbError?: string
}

/**
 * Report WHERE each credential field would resolve from, without ever
 * returning a value. Exists because "not configured" was previously
 * indistinguishable from "DB row exists but env fallback also set", "DB
 * unreachable", or "tenant key doesn't match what you assumed" — all of which
 * look identical from the outside and each need a different fix. This
 * collapses that guessing into one call.
 */
export async function diagnoseTenantCredentials(
  tenantKey: string | null,
  provider: CredentialProvider,
  envPrefix: string,
  fields: readonly string[],
): Promise<CredentialDiagnostic> {
  const dbBundle: CredentialBundle = {}
  let dbReachable = true
  let dbError: string | undefined

  if (tenantKey) {
    try {
      const { authQuery } = await import('./db-auth')
      const rows = await authQuery<{ field: string; value_encrypted: string }>(
        `SELECT field, value_encrypted
           FROM tenant_credentials
          WHERE tenant_key = $1 AND provider = $2 AND is_active`,
        [tenantKey, provider],
      )
      // Presence only — never decrypt for a diagnostic. Whether the value
      // decrypts correctly is exactly what resolveTenantCredentials proves by
      // actually using it; this just answers "does a row exist".
      for (const row of rows) dbBundle[row.field] = row.field
    } catch (err) {
      dbReachable = false
      dbError = err instanceof Error ? err.message : String(err)
    }
  }

  const result: Record<string, 'db' | 'env' | 'missing'> = {}
  for (const field of fields) {
    if (dbBundle[field]) {
      result[field] = 'db'
      continue
    }
    const suffix = field.toUpperCase()
    // Same lookup resolveTenantCredentials performs — see tenantEnvVarName.
    const present = tenantKey
      ? Boolean(process.env[tenantEnvVarName(tenantKey, envPrefix, suffix)])
      : Boolean(process.env[`${envPrefix}_${suffix}`])
    result[field] = present ? 'env' : 'missing'
  }

  return { tenantKey, provider, envPrefix, fields: result, dbReachable, ...(dbError ? { dbError } : {}) }
}
