/**
 * Tenant-facing view of a PUBLISHED AI-generated dashboard.
 *
 * Distinct from app/api/ai/[...path]/route.ts, which is ADMIN-ONLY (the
 * builder itself: discovery, generation, publish). Publishing previously only
 * wrote domain->tenant routing so a client's login continued to the existing
 * hand-built Overview/LMS pages — the AI-generated config was never actually
 * shown to the tenant it was built for, only to an admin previewing the
 * builder. This route is what makes "click Publish -> visible to the real
 * user" true: any authenticated user whose resolved tenant matches the
 * dashboard's OWNING tenant may view it — not just admins, and not any other
 * signed-in user. Resolution reuses the exact same functions every other
 * route in this app already uses for tenant isolation (resolvePharmaTenant,
 * resolveRolplayAppAccess) — never a new, parallel authorization rule.
 *
 * dashboard_metadata lives in the SAME Postgres auth DB the rest of this app
 * already queries (ai-service/app/db.py: "reuses the Next.js auth DB, adds
 * new tables only") — read directly via authQuery rather than round-tripping
 * through the admin-gated AI proxy, which this caller may not be able to pass.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authQuery } from '@/lib/db-auth'
import { getAuthContextFromRequest, type ApiAuthContext } from '@/lib/server-auth'
import { findUserById } from '@/lib/db-users'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { resolveRolplayAppAccess } from '@/lib/bridge-rolplay-app'
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8088'
const PHARMA_KINDS = new Set(['pharma_kpi', 'pharma_sale_exercises', 'pharma_exceltis_rest'])
const VIEW_LIMIT = 60
const VIEW_WINDOW_MS = 60_000

interface StoredConnectorHandle { client_id?: number | string }
interface StoredConfig { connector: string; connector_handle?: StoredConnectorHandle }

async function isAuthorized(auth: ApiAuthContext, slug: string, cfg: StoredConfig): Promise<boolean> {
  const user = await findUserById(auth.userId).catch(() => null)
  if (user?.role === 'admin') return true

  if (PHARMA_KINDS.has(cfg.connector)) {
    const tenant = await resolvePharmaTenant(auth.email)
    return tenant === slug
  }
  if (cfg.connector === 'rolplay_app_sql') {
    const clientId = await resolveRolplayAppAccess(auth.email)
    const owningClientId = Number(cfg.connector_handle?.client_id)
    return clientId !== null && Number.isFinite(owningClientId) && clientId === owningClientId
  }
  // coach_app_sql and anything else: no verified per-user access resolver
  // wired up against a slug yet — deny rather than guess who owns it.
  return false
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
  }

  const auth = await getAuthContextFromRequest(request)
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const limit = rateLimit(`dashboard-view:${auth.userId}`, VIEW_LIMIT, VIEW_WINDOW_MS)
  if (!limit.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: rateLimitHeaders(limit) })
  }

  const rows = await authQuery<{ config: unknown }>(
    'SELECT config FROM dashboard_metadata WHERE slug = $1 AND published = TRUE LIMIT 1',
    [slug],
  ).catch(() => [])
  const row = rows[0]
  if (!row) {
    return NextResponse.json({ error: 'This dashboard has not been published yet.' }, { status: 404 })
  }
  const cfg = (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as StoredConfig

  if (!(await isAuthorized(auth, slug, cfg))) {
    return NextResponse.json({ error: 'You do not have access to this dashboard.' }, { status: 403 })
  }

  const internalSecret = process.env.AI_SERVICE_SHARED_SECRET
  const headers: Record<string, string> = {}
  if (internalSecret) headers['X-Internal-Auth'] = internalSecret

  try {
    const res = await fetch(
      `${AI_SERVICE_URL.replace(/\/+$/, '')}/ai/render/${encodeURIComponent(slug)}`,
      { headers, cache: 'no-store', signal: AbortSignal.timeout(30_000) },
    )
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Dashboard service unreachable: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
