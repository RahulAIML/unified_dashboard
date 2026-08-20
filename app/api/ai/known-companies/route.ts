/**
 * GET /api/ai/known-companies — the Dashboard Builder's company picker.
 *
 * A more specific route than app/api/ai/[...path]/route.ts's catch-all
 * proxy (Next.js routes an exact static segment here first), because this
 * one needs to MERGE two genuinely separate tenant sources, not just
 * forward to ai-service:
 *
 *   1. rolplay_app_sql clients (ai-service's own /ai/known-companies,
 *      reading r_client on the remote game DB) — real session/user counts,
 *      plus r_client.created_on (confirmed real and sane via a direct
 *      information_schema query, e.g. a client created 3 days before this
 *      was written) — used for "new" the same way a DB-backed pharma
 *      tenant's createdAt is.
 *   2. Pharma tenants, merged from TWO places exactly like
 *      app/api/admin/tenants/route.ts does: lib/db-tenants.ts's
 *      pharma_tenants table (self-service tenants created via the admin
 *      "invite a client" flow, app/api/admin/tenants/route.ts's
 *      upsertTenant) AND lib/pharma-tenant.ts's hardcoded TENANT_CONFIG
 *      (developer-onboarded tenants that were never written to that table
 *      at all — e.g. Heineken, which has been a real, already-deployed
 *      exceltis_rest tenant baked into code since before the self-service
 *      wizard existed). Missing the hardcoded half was the actual root
 *      cause of the reported bug: an admin looked for "Heineken" in the
 *      picker, and since it's a code-level tenant with no pharma_tenants
 *      row, a first version of this route (DB-only) still couldn't find it
 *      — verified live by checking /admin/tenants, which lists Heineken as
 *      a registered client despite an empty pharma_tenants table locally.
 *
 * `isNew` flags, for the builder UI's red "Nuevo" badge, either a rolplay_app_sql
 * client created within the last 14 days (real r_client.created_on) or a
 * SELF-SERVICE pharma tenant (a real DB row) created within the last 14
 * days. Hardcoded pharma tenants (TENANT_CONFIG) are never flagged new --
 * a tenant baked into source code was "already deployed" by definition, and
 * has no creation timestamp of any kind to derive it from. That's an honest
 * limitation, not an oversight.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit'
import { listAllTenants } from '@/lib/db-tenants'
import { TENANT_CONFIG } from '@/lib/pharma-tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8088'
const AI_LIMIT = 60
const AI_WINDOW_MS = 60_000
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
      // created_on can be missing/unparseable for an old row predating the
      // column, or if ai-service's SQL bridge returns it in a shape Date()
      // can't parse -- never let that crash the picker, just isNew=false.
      const createdAt = r.created_on ? new Date(r.created_on) : null
      const isNew = createdAt != null && !isNaN(createdAt.getTime()) && now - createdAt.getTime() < NEW_TENANT_WINDOW_MS
      return {
        id: `rolplay_app_sql:${r.id}`, name: r.name, sessions: r.sessions, users: r.users,
        source: 'rolplay_app_sql' as const, isNew,
      }
    })
  } catch (err) {
    // The picker is a convenience — free-text entry still works if this
    // fails — but a silent catch here made an ai-service outage
    // indistinguishable from "this tenant genuinely has no rolplay_app_sql
    // clients," which is exactly the failure mode already fixed elsewhere
    // in the discovery pipeline (see ai-service/app/agents/schema_discovery.py).
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

  // Hardcoded tenants never have a DB row -- surfaced the same way
  // app/api/admin/tenants/route.ts does, keyed off the same TENANT_CONFIG,
  // skipping any key a DB row already covers (a tenant can be migrated from
  // code to the DB without appearing twice).
  const dbKeys = new Set(dbTenants.map(t => t.tenantKey))
  const hardcodedRows: KnownCompanyRow[] = Object.keys(TENANT_CONFIG)
    .filter(key => !dbKeys.has(key))
    .map(key => ({
      id: `pharma:${key}`, name: key, sessions: 0, users: 0,
      source: 'pharma' as const, isNew: false,
    }))

  return [...dbRows, ...hardcodedRows]
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }
  const limit = rateLimit(`ai:${admin.email}`, AI_LIMIT, AI_WINDOW_MS)
  if (!limit.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: rateLimitHeaders(limit) })
  }

  const [rolplayAppRows, pharmaRows] = await Promise.all([fetchRolplayAppCompanies(), fetchPharmaTenants()])

  // De-dupe by case-insensitive name: a name already known to rolplay_app_sql
  // (real session data) wins over a same-named pharma placeholder.
  const seen = new Set(rolplayAppRows.map(r => r.name.trim().toLowerCase()))
  const merged = [...rolplayAppRows, ...pharmaRows.filter(r => !seen.has(r.name.trim().toLowerCase()))]

  // Newly-invited clients surface first — that's the entire point of the
  // "Nuevo" badge, and a manager who just invited a client shouldn't have to
  // scroll past 30 dormant test entries to find it.
  merged.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
    if (b.sessions !== a.sessions) return b.sessions - a.sessions
    return a.name.localeCompare(b.name)
  })

  return NextResponse.json(merged)
}
