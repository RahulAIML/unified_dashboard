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
import { getKnownCompanies } from '@/lib/known-companies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AI_LIMIT = 60
const AI_WINDOW_MS = 60_000

export type { KnownCompanyRow } from '@/lib/known-companies'

export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }
  const limit = rateLimit(`ai:${admin.email}`, AI_LIMIT, AI_WINDOW_MS)
  if (!limit.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: rateLimitHeaders(limit) })
  }

  return NextResponse.json(await getKnownCompanies())
}
