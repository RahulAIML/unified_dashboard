import { NextRequest } from 'next/server'
import { getEvaluationResults } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  if (ctx.customerId === 0) {
    return buildSuccess({ data: [] })
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

    // Second Brain → API-only
    if (solution === 'second-brain') {
      return buildSuccess(
        { data: [] },
        { solution, source: 'second-brain-api-only' }
      )
    }

    const limit = Math.min(Number(sp.get('limit') ?? 50), 200)

    const rows = await getEvaluationResults(
      { from: range.from, to: range.to, usecaseIds, customerId: ctx.customerId },
      limit
    )

    return buildSuccess(
      { data: rows },
      {
        from:       range.from.toISOString(),
        to:         range.to.toISOString(),
        solution,
        usecaseIds: usecaseIds ?? null,
        limit,
      }
    )
  } catch (err) {
    console.error('[/api/dashboard/results]', err)
    return buildApiError('Failed to load evaluation results')
  }
}
