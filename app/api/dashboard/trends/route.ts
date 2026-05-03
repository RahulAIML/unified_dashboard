import { NextRequest } from 'next/server'
import { getDashboardTrends } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  if (ctx.customerId === 0) {
    return buildSuccess({ scoreTrend: [], passFailTrend: [], evalCountTrend: [] })
  }

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400, {
        from: sp.get('from'),
        to:   sp.get('to'),
      })
    }

    // ── Dynamic usecase resolution ────────────────────────────────────────────
    const solution   = sp.get('solution')
    const idsParam   = sp.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : await resolveDynamicUsecaseIds(ctx.customerId, solution)

    // Second Brain → API-only, no DB trends
    if (solution === 'second-brain') {
      return buildSuccess(
        { scoreTrend: [], passFailTrend: [], evalCountTrend: [] },
        { solution, source: 'second-brain-api-only' }
      )
    }

    const data = await getDashboardTrends({
      from:       range.from,
      to:         range.to,
      usecaseIds,
      customerId: ctx.customerId,
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
