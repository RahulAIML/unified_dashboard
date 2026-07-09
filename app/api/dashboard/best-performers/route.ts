import { NextRequest } from 'next/server'
import { bridgeBestPerformers } from '@/lib/bridge-client'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardBestPerformers } from '@/lib/bridge-banco-analytics'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDashboardBestPerformers } from '@/lib/bridge-pharma-analytics'
import { isDemoMode } from '@/lib/demo'
import { demoBestPerformers } from '@/lib/demo/engine'

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
    const lim   = Math.min(5, Math.max(1, Number(sp.get('limit')) || 5))
    return buildSuccess(demoBestPerformers(range.from, range.to, lim, sol), { source: 'demo' })
  }

  const orgType = resolveOrgType(ctx.email, ctx.customerId)
  if (orgType === 'none') return buildSuccess({ data: [] })

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400)
    }

    const solution = sp.get('solution')
    const limit    = Math.min(5, Math.max(1, Number(sp.get('limit')) || 5))

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
    if (orgType === 'pharma') {
      const tenant = resolvePharmaTenant(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

      const data = await pharmaDashboardBestPerformers(tenant, {
        fromIso: range.from.toISOString(),
        toIso:   range.to.toISOString(),
        limit,
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(), source: `pharma-${tenant}`, limit,
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
