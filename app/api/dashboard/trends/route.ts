import { NextRequest } from 'next/server'
import { getDashboardTrends } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardTrends } from '@/lib/bridge-banco-analytics'
import { isDemoMode } from '@/lib/demo'
import { demoTrends } from '@/lib/demo/engine'

export const runtime = 'nodejs'

const EMPTY = { scoreTrend: [], passFailTrend: [], evalCountTrend: [] }

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
    return buildSuccess(demoTrends(range.from, range.to, sol), { source: 'demo' })
  }

  const orgType = resolveOrgType(ctx.email, ctx.customerId)
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
      const data = await bancoDashboardTrends({
        fromIso: range.from.toISOString(),
        toIso:   range.to.toISOString(),
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(), source: 'banco',
      })
    }

    // ── Standard analytics pipeline ───────────────────────────────────────────
    const idsParam   = sp.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : await resolveDynamicUsecaseIds(ctx.customerId, solution)

    const data = await getDashboardTrends({
      from: range.from, to: range.to, usecaseIds, customerId: ctx.customerId,
    })

    return buildSuccess(data, {
      from:       range.from.toISOString(),
      to:         range.to.toISOString(),
      solution,
      usecaseIds: usecaseIds ?? null,
    })
  } catch (err) {
    console.error('[/api/dashboard/trends]', err)
    return buildApiError('Failed to load trend data')
  }
}
