import { NextRequest } from 'next/server'
import { getUsecaseBreakdown } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardUsecaseBreakdown } from '@/lib/bridge-banco-analytics'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDashboardUsecaseBreakdown } from '@/lib/bridge-pharma-analytics'
import { isDemoMode } from '@/lib/demo'
import { demoUsecaseBreakdown } from '@/lib/demo/engine'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // ── DEMO MODE ──────────────────────────────────────────────────────────────
  if (isDemoMode()) {
    const sp    = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) return buildApiError('Invalid date range', 400)
    const sol   = sp.get('solution')
    if (sol === 'second-brain') return buildSuccess({ data: [] }, { source: 'demo' })
    return buildSuccess(demoUsecaseBreakdown(range.from, range.to, sol), { source: 'demo' })
  }

  const orgType = await resolveOrgType(ctx.email, ctx.customerId)
  if (orgType === 'none') return buildSuccess({ data: [] })

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
      return buildSuccess({ data: [] }, { solution, source: 'second-brain-api-only' })
    }

    // ── Banco pipeline ────────────────────────────────────────────────────────
    if (orgType === 'banco') {
      const data = await bancoDashboardUsecaseBreakdown({
        fromIso: range.from.toISOString(),
        toIso:   range.to.toISOString(),
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(), source: 'banco',
      })
    }

    // ── Pharma-sim pipeline (Sanfer, Apotex, …) ───────────────────────────────
    if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenant(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

      const data = await pharmaDashboardUsecaseBreakdown(tenant, {
        fromIso: range.from.toISOString(),
        toIso:   range.to.toISOString(),
        solution,
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(), solution, source: `pharma-${tenant}`,
      })
    }

    // ── Standard analytics pipeline ───────────────────────────────────────────
    const idsParam   = sp.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : await resolveDynamicUsecaseIds(ctx.customerId, solution)

    const rows = await getUsecaseBreakdown({
      from: range.from, to: range.to, usecaseIds, customerId: ctx.customerId,
    })

    return buildSuccess(
      { data: rows },
      { from: range.from.toISOString(), to: range.to.toISOString(), solution, usecaseIds: usecaseIds ?? null }
    )
  } catch (err) {
    console.error('[/api/dashboard/usecase-breakdown]', err)
    return buildApiError('Failed to load usecase breakdown')
  }
}
