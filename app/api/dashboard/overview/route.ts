import { NextRequest } from 'next/server'
import { getDashboardOverview } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange, parseUsecaseFilter } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // User is authenticated but not linked to any organization → empty state
  if (ctx.customerId === 0) {
    return buildSuccess({
      totalEvaluations: 0, prevTotalEvaluations: 0,
      avgScore: null, prevAvgScore: null,
      passRate: null, prevPassRate: null,
      passedEvaluations: 0,
    })
  }

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400, {
        from: sp.get('from'),
        to: sp.get('to'),
      })
    }

    const { solution, usecaseIds } = parseUsecaseFilter(sp)

    const data = await getDashboardOverview({
      from: range.from,
      to: range.to,
      usecaseIds,
      customerId: ctx.customerId,
    })

    return buildSuccess(data, {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      solution,
      usecaseIds: usecaseIds ?? null,
    })
  } catch (err) {
    console.error('[/api/dashboard/overview]', err)
    return buildApiError('Failed to load overview data')
  }
}

