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
 *      but that table has no creation-date column, so these can never be
 *      flagged "new".
 *   2. Self-service pharma tenants (lib/db-tenants.ts's pharma_tenants
 *      table, THIS app's own Postgres) — created via the admin "invite a
 *      client" flow (app/api/admin/tenants/route.ts's upsertTenant), which
 *      the picker never surfaced at all before this fix. A tenant invited
 *      here (e.g. a newly onboarded pharma_kpi/exceltis_rest client) has no
 *      real session data yet by definition — that's the whole reported bug:
 *      "Heineken was invited but never showed up in the list, so the name
 *      had to be typed manually."
 *
 * `isNew` flags a pharma tenant created within the last 14 days, for the
 * builder UI's red "Nuevo" badge. rolplay_app_sql entries are never flagged
 * new (no reliable signal exists for them — see above), which is an honest
 * limitation, not an oversight.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit'
import { listActiveTenants } from '@/lib/db-tenants'

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
    if (!res.ok) return []
    const rows: { id: number; name: string; sessions: number; users: number }[] = await res.json()
    if (!Array.isArray(rows)) return []
    return rows.map(r => ({
      id: `rolplay_app_sql:${r.id}`, name: r.name, sessions: r.sessions, users: r.users,
      source: 'rolplay_app_sql' as const, isNew: false,
    }))
  } catch {
    // The picker is a convenience — free-text entry still works if this fails.
    return []
  }
}

async function fetchPharmaTenants(): Promise<KnownCompanyRow[]> {
  try {
    const tenants = await listActiveTenants()
    const now = Date.now()
    return tenants.map(t => ({
      id: `pharma:${t.tenantKey}`, name: t.displayName, sessions: 0, users: 0,
      source: 'pharma' as const,
      isNew: now - new Date(t.createdAt).getTime() < NEW_TENANT_WINDOW_MS,
    }))
  } catch {
    return []
  }
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
