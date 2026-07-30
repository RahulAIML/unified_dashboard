/**
 * /api/admin/credentials — write per-tenant integration credentials at runtime.
 *
 * This is the endpoint that makes the credential store reachable, and therefore
 * the one that actually delivers "onboard a tenant with no redeploy". Without
 * it, migrations/006 is an empty table and every tenant still depends on
 * environment variables.
 *
 * SECURITY
 *  - Admin only, same gate as the rest of /api/admin.
 *  - Values are encrypted before they touch the database (lib/secret-crypto.ts).
 *  - GET NEVER returns credential values, not even encrypted. It reports which
 *    fields are configured. An admin API that echoes secrets back turns one
 *    stolen admin session into a full credential dump, and there is no
 *    legitimate reason to read a secret back out — you rotate, you don't read.
 *  - Rate limited: this endpoint performs encryption and DB writes.
 */
import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { encryptSecret, isSecretCryptoConfigured } from '@/lib/secret-crypto'
import { invalidateTenantCredentials, type CredentialProvider } from '@/lib/tenant-credentials'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROVIDERS: CredentialProvider[] = ['lms', 'bridge', 'second_brain']

/**
 * Allowed field names per provider. A whitelist rather than free text: the field
 * name becomes part of an env-var lookup on the read path, so accepting
 * arbitrary names would let a caller probe unrelated environment variables.
 */
const FIELDS: Record<CredentialProvider, readonly string[]> = {
  lms: ['api_url', 'client_id', 'client_secret', 'access_token'],
  bridge: ['url', 'x_tenant', 'auth_header_name', 'auth_header_value'],
  second_brain: ['api_url', 'admin_email', 'token'],
}

function isProvider(v: unknown): v is CredentialProvider {
  return typeof v === 'string' && (PROVIDERS as string[]).includes(v)
}

/** Tenant keys address rows and build env var names — keep them boring. */
function validTenantKey(v: unknown): v is string {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,62}$/i.test(v)
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  const limit = rateLimit(`admin-credentials:${admin.email}`, 30, 60_000)
  if (!limit.ok) {
    return buildApiError('Rate limit exceeded', 429, { retryAfterSeconds: limit.retryAfter })
  }

  if (!isSecretCryptoConfigured()) {
    // Fail loudly rather than storing plaintext. A missing key is an operator
    // problem with a one-line fix, and silently degrading would put unencrypted
    // secrets in Postgres — the exact thing this table exists to prevent.
    return buildApiError(
      'SECRET_ENCRYPTION_KEY is not configured on this server. Generate one with ' +
      '`openssl rand -base64 32` and set it in the environment before storing credentials.',
      503,
    )
  }

  let body: { tenantKey?: unknown; provider?: unknown; values?: unknown }
  try {
    body = await request.json()
  } catch {
    return buildApiError('Invalid JSON in request body', 400)
  }

  const { tenantKey, provider, values } = body
  if (!validTenantKey(tenantKey)) {
    return buildApiError('tenantKey must be alphanumeric with . _ - (max 63 chars)', 400)
  }
  if (!isProvider(provider)) {
    return buildApiError(`provider must be one of: ${PROVIDERS.join(', ')}`, 400)
  }
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return buildApiError('values must be an object of field → value', 400)
  }

  const allowed = FIELDS[provider]
  const entries = Object.entries(values as Record<string, unknown>)
  if (entries.length === 0) return buildApiError('values must not be empty', 400)

  for (const [field, value] of entries) {
    if (!allowed.includes(field)) {
      return buildApiError(
        `Unknown field '${field}' for provider '${provider}'. Allowed: ${allowed.join(', ')}`,
        400,
      )
    }
    if (typeof value !== 'string' || !value.trim()) {
      return buildApiError(`Field '${field}' must be a non-empty string`, 400)
    }
  }

  try {
    const { authQuery } = await import('@/lib/db-auth')
    for (const [field, value] of entries) {
      await authQuery(
        `INSERT INTO tenant_credentials (tenant_key, provider, field, value_encrypted, updated_at)
              VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_key, provider, field)
         DO UPDATE SET value_encrypted = EXCLUDED.value_encrypted,
                       is_active = TRUE,
                       updated_at = NOW()`,
        [tenantKey, provider, field, encryptSecret(String(value).trim())],
      )
    }

    // Without this the 30s read cache would serve stale credentials right after
    // an admin fixed them — which is exactly when someone is watching.
    invalidateTenantCredentials(tenantKey, provider)

    // Field NAMES only. Values must never reach a log.
    console.info(
      `[audit] credentials-write admin=${admin.email} tenant=${tenantKey} ` +
      `provider=${provider} fields=${entries.map(([f]) => f).join(',')}`,
    )

    return buildSuccess(
      { tenantKey, provider, fieldsStored: entries.map(([f]) => f) },
      { encrypted: true },
    )
  } catch (err) {
    console.error('[/api/admin/credentials POST]', err)
    return buildApiError(
      'Failed to store credentials. If this says the table is missing, run migrations/006_tenant_credentials.sql.',
      500,
    )
  }
}

/**
 * Report which fields are configured for a tenant — names and timestamps only,
 * never values. Enough to answer "is this tenant set up?" without creating a
 * secret-exfiltration path.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  const tenantKey = request.nextUrl.searchParams.get('tenantKey')
  if (!validTenantKey(tenantKey)) {
    return buildApiError('tenantKey query parameter is required', 400)
  }

  try {
    const { authQuery } = await import('@/lib/db-auth')
    const rows = await authQuery<{ provider: string; field: string; updated_at: string }>(
      `SELECT provider, field, updated_at
         FROM tenant_credentials
        WHERE tenant_key = $1 AND is_active
        ORDER BY provider, field`,
      [tenantKey],
    )

    const byProvider: Record<string, { field: string; updatedAt: string }[]> = {}
    for (const r of rows) {
      ;(byProvider[r.provider] ??= []).push({ field: r.field, updatedAt: r.updated_at })
    }

    return buildSuccess(
      { tenantKey, providers: byProvider },
      { note: 'Values are never returned — rotate rather than read.' },
    )
  } catch (err) {
    console.error('[/api/admin/credentials GET]', err)
    return buildApiError('Failed to read credential metadata', 500)
  }
}
