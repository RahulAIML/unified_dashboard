import { NextRequest } from 'next/server'
import { bridgeBestPerformers } from '@/lib/bridge-client'
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
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400)
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

    // Production requirement: always top-5 performers; cap client requests
    const limit = Math.min(5, Math.max(1, Number(sp.get('limit')) || 5))

    const rows = await bridgeBestPerformers({
      customerId: ctx.customerId,
      fromIso:    range.from.toISOString(),
      toIso:      range.to.toISOString(),
      usecaseIds,
      limit,
    })

    return buildSuccess(
      { data: rows },
      {
        from:     range.from.toISOString(),
        to:       range.to.toISOString(),
        solution,
        limit,
      }
    )
  } catch (err) {
    console.error('[/api/dashboard/best-performers]', err)
    return buildApiError('Failed to load best performers data')
  }
}
