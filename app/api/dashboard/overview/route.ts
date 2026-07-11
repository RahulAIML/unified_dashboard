import { NextRequest } from 'next/server'
import { getDashboardOverview } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardOverview } from '@/lib/bridge-banco-analytics'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDashboardOverview } from '@/lib/bridge-pharma-analytics'
import { isDemoMode } from '@/lib/demo'
import { demoOverview } from '@/lib/demo/engine'

export const runtime = 'nodejs'

const EMPTY = {
  totalEvaluations: 0, prevTotalEvaluations: 0,
  avgScore: null,      prevAvgScore: null,
  passRate: null,      prevPassRate: null,
  passedEvaluations: 0,
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // ── DEMO MODE ──────────────────────────────────────────────────────────────
  if (isDemoMode()) {
    const sp    = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) return buildApiError('Invalid date range', 400)
    const sol   = sp.get('solution')
    if (sol === 'second-brain') return buildSuccess(EMPTY, { source: 'demo' })
    return buildSuccess(demoOverview(range.from, range.to, sol), { source: 'demo' })
  }

  const orgType = await resolveOrgType(ctx.email, ctx.customerId)
  if (orgType === 'none') return buildSuccess(EMPTY)

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400, {
        from: sp.get('from'), to: sp.get('to'),
      })
    }

    const solution = sp.get('solution')

    if (solution === 'second-brain') {
      return buildSuccess(EMPTY, { solution, source: 'second-brain-api-only' })
    }

    // ── Banco pipeline ────────────────────────────────────────────────────────
    if (orgType === 'banco') {
      const spanMs   = Math.max(0, range.to.getTime() - range.from.getTime())
      const prevTo   = new Date(range.from.getTime() - 1)
      const prevFrom = new Date(prevTo.getTime() - spanMs)

      const data = await bancoDashboardOverview({
        fromIso:     range.from.toISOString(),
        toIso:       range.to.toISOString(),
        prevFromIso: prevFrom.toISOString(),
        prevToIso:   prevTo.toISOString(),
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(),
        source: 'banco',
      })
    }

    // ── Pharma-sim pipeline (Sanfer, Apotex, …) ───────────────────────────────
    if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenant(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

      const spanMs   = Math.max(0, range.to.getTime() - range.from.getTime())
      const prevTo   = new Date(range.from.getTime() - 1)
      const prevFrom = new Date(prevTo.getTime() - spanMs)

      const data = await pharmaDashboardOverview(tenant, {
        fromIso:     range.from.toISOString(),
        toIso:       range.to.toISOString(),
        prevFromIso: prevFrom.toISOString(),
        prevToIso:   prevTo.toISOString(),
        solution,
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(),
        solution, source: `pharma-${tenant}`,
      })
    }

    // ── Standard analytics pipeline ───────────────────────────────────────────
    const idsParam   = sp.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : await resolveDynamicUsecaseIds(ctx.customerId, solution)

    const data = await getDashboardOverview({
      from: range.from, to: range.to, usecaseIds, customerId: ctx.customerId,
    })

    return buildSuccess(data, {
      from:       range.from.toISOString(),
      to:         range.to.toISOString(),
      solution,
      usecaseIds: usecaseIds ?? null,
    })
  } catch (err) {
    console.error('[/api/dashboard/overview]', err)
    return buildApiError('Failed to load overview data')
  }
}
