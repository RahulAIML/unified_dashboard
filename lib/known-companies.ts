/**
 * Shared logic behind GET /api/ai/known-companies (the Dashboard Builder's
 * company picker) — merges rolplay_app_sql clients with pharma tenants (both
 * self-service DB rows and hardcoded TENANT_CONFIG entries).
 *
 * Extracted out of app/api/ai/known-companies/route.ts and called from BOTH
 * that route AND app/api/ai/[...path]/route.ts's catch-all GET handler.
 * Confirmed live in production that requests to /api/ai/known-companies were
 * actually being resolved by the catch-all (not the static sibling route) --
 * proven with a POST, which returned a raw FastAPI "Method Not Allowed" body,
 * meaning the request reached ai-service unmodified rather than hitting
 * Next's own 405 for a route with no POST handler. Whatever Next-internal
 * reason causes that precedence, duplicating the merge logic into the
 * catch-all closes the gap unconditionally instead of depending on folder-
 * based route resolution behaving as documented.
 */
import { listAllTenants } from '@/lib/db-tenants'
import { TENANT_CONFIG } from '@/lib/pharma-tenant'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8088'
const NEW_TENANT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export interface KnownCompanyRow {
  id: string
  name: string
  sessions: number
  users: number
  source: 'rolplay_app_sql' | 'pharma'
  isNew: boolean
}

async function fetchRolplayAppCompanies(): Promise<KnownCompanyRow[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const internalSecret = process.env.AI_SERVICE_SHARED_SECRET
  if (internalSecret) headers['X-Internal-Auth'] = internalSecret
  try {
    const res = await fetch(`${AI_SERVICE_URL.replace(/\/+$/, '')}/ai/known-companies`, {
      headers, cache: 'no-store', signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.error(`[known-companies] ai-service returned ${res.status}`)
      return []
    }
    const rows: { id: number; name: string; created_on: string | null; sessions: number; users: number }[] = await res.json()
    if (!Array.isArray(rows)) return []

    const now = Date.now()
    return rows.map(r => {
      const createdAt = r.created_on ? new Date(r.created_on) : null
      const isNew = createdAt != null && !isNaN(createdAt.getTime()) && now - createdAt.getTime() < NEW_TENANT_WINDOW_MS
      return {
        id: `rolplay_app_sql:${r.id}`, name: r.name, sessions: r.sessions, users: r.users,
        source: 'rolplay_app_sql' as const, isNew,
      }
    })
  } catch (err) {
    console.error('[known-companies] ai-service unreachable:', (err as Error).message)
    return []
  }
}

async function fetchPharmaTenants(): Promise<KnownCompanyRow[]> {
  const now = Date.now()
  let dbTenants: Awaited<ReturnType<typeof listAllTenants>> = []
  try {
    dbTenants = await listAllTenants()
  } catch {
    // The picker is a convenience — free-text entry still works if this fails.
  }
  const dbRows: KnownCompanyRow[] = dbTenants
    .filter(t => t.isActive)
    .map(t => ({
      id: `pharma:${t.tenantKey}`, name: t.displayName, sessions: 0, users: 0,
      source: 'pharma' as const,
      isNew: now - new Date(t.createdAt).getTime() < NEW_TENANT_WINDOW_MS,
    }))

  const dbKeys = new Set(dbTenants.map(t => t.tenantKey))
  const hardcodedRows: KnownCompanyRow[] = Object.keys(TENANT_CONFIG)
    .filter(key => !dbKeys.has(key))
    .map(key => ({
      id: `pharma:${key}`, name: key, sessions: 0, users: 0,
      source: 'pharma' as const, isNew: false,
    }))

  return [...dbRows, ...hardcodedRows]
}

export async function getKnownCompanies(): Promise<KnownCompanyRow[]> {
  const [rolplayAppRows, pharmaRows] = await Promise.all([fetchRolplayAppCompanies(), fetchPharmaTenants()])

  // De-dupe by case-insensitive name: a name already known to rolplay_app_sql
  // (real session data) wins over a same-named pharma placeholder.
  const seen = new Set(rolplayAppRows.map(r => r.name.trim().toLowerCase()))
  const merged = [...rolplayAppRows, ...pharmaRows.filter(r => !seen.has(r.name.trim().toLowerCase()))]

  merged.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
    if (b.sessions !== a.sessions) return b.sessions - a.sessions
    return a.name.localeCompare(b.name)
  })

  return merged
}
