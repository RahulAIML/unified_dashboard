import { NextRequest } from 'next/server'
import { bridgeBestPerformers } from '@/lib/bridge-client'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardBestPerformers } from '@/lib/bridge-banco-analytics'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { resolveRolplayAppAccess, rolplayAppBestPerformers } from '@/lib/bridge-rolplay-app'
import { resolveDataSources, fetchBestPerformers } from '@/lib/data-sources'
import { isDemoDataEnabled } from '@/lib/demo'
import { demoBestPerformers } from '@/lib/demo/engine'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // ── DEMO MODE ──────────────────────────────────────────────────────────────
  if (isDemoDataEnabled(ctx.email)) {
    const sp    = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) return buildApiError('Invalid date range', 400)
    const sol   = sp.get('solution')
    if (sol === 'second-brain') return buildSuccess({ data: [] }, { source: 'demo' })
    // Cap raised 5 -> 20: Overview's own card already requested limit=10 and
    // was silently truncated to 5 by this cap; the new dedicated /ranking
    // page (a fuller leaderboard, not just an Overview summary card) needs
    // more than 5 too. 20 still matches rolplayAppBestPerformers' own
    // internal ceiling of 50, so this stays a real, bounded cap either way.
    const lim   = Math.min(20, Math.max(1, Number(sp.get('limit')) || 5))
    return buildSuccess(demoBestPerformers(range.from, range.to, lim, sol), { source: 'demo' })
  }

  const orgType = await resolveOrgType(ctx.email, ctx.customerId)
  if (orgType === 'none') return buildSuccess({ data: [] })

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400)
    }

    const solution = sp.get('solution')
    const limit    = Math.min(20, Math.max(1, Number(sp.get('limit')) || 5))

    if (solution === 'second-brain') {
      return buildSuccess({ data: [] }, { solution, source: 'second-brain-api-only' })
    }

    // ── Banco pipeline ────────────────────────────────────────────────────────
    if (orgType === 'banco') {
      const data = await bancoDashboardBestPerformers({
        fromIso: range.from.toISOString(),
        toIso:   range.to.toISOString(),
        limit,
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(), source: 'banco', limit,
      })
    }

    // ── Pharma-sim pipeline (Sanfer, Apotex, …) ───────────────────────────────
    // Rolplay App SQL composed in as the primary source when it also
    // resolves for this identity -- see lib/data-sources.ts.
    if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenantAccess(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

      const sources = await resolveDataSources(ctx.email, tenant, solution)
      const result = await fetchBestPerformers(sources, limit, {
        fromIso: range.from.toISOString(), toIso: range.to.toISOString(),
      }, solution)
      if (!result) return buildApiError('Pharma tenant could not be resolved', 500)

      return buildSuccess({ data: result.data, allTimeStats: result.allTimeStats }, {
        from: range.from.toISOString(), to: range.to.toISOString(), solution, source: result.source, limit,
      })
    }

    // ── Rolplay-app platform (top users by avg score) ─────────────────────────
    if (orgType === 'rolplay-app') {
      const clientId = await resolveRolplayAppAccess(ctx.email)
      if (!clientId) return buildApiError('Rolplay-app client could not be resolved', 500)
      const data = await rolplayAppBestPerformers(clientId, limit, {
        fromIso: range.from.toISOString(), toIso: range.to.toISOString(),
      }, solution)
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(), source: `rolplay-app-${clientId}`, limit,
      })
    }

    // ── Standard analytics pipeline ───────────────────────────────────────────
    const idsParam   = sp.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : await resolveDynamicUsecaseIds(ctx.customerId, solution)

    const rows = await bridgeBestPerformers({
      customerId: ctx.customerId,
      fromIso:    range.from.toISOString(),
      toIso:      range.to.toISOString(),
      usecaseIds,
      limit,
    })

    return buildSuccess(
      { data: rows },
      { from: range.from.toISOString(), to: range.to.toISOString(), solution, limit }
    )
  } catch (err) {
    console.error('[/api/dashboard/best-performers]', err)
    return buildApiError('Failed to load best performers data')
  }
}
