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
      // Non-alphanumerics collapse to '_' — a key like 'apotex-mx' would
      // otherwise build an env name that cannot legally be set.
      const scoped = tenantKey.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
      const v = process.env[`${envPrefix}_${scoped}_${suffix}`]
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
