import { NextRequest } from 'next/server'
import { bridgeBestPerformers } from '@/lib/bridge-client'
import { buildSuccess, buildApiError, parseDateRange, parseUsecaseFilter } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // No org → empty
  if (ctx.customerId === 0) {
    return buildSuccess({ data: [] })
  }

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400)
    }

    const { solution, usecaseIds } = parseUsecaseFilter(sp)

    // Production requirement: always return top 5 performers (no global fallback lists).
    // Cap limit at 5 even if a client attempts to request more.
    const limit = Math.min(5, Math.max(1, Number(sp.get('limit')) || 5))

    const rows = await bridgeBestPerformers({
      customerId: ctx.customerId,
      fromIso: range.from.toISOString(),
      toIso: range.to.toISOString(),
      usecaseIds,
      limit,
    })

    return buildSuccess(
      { data: rows },
      {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        solution,
        limit,
      }
    )
  } catch (err) {
    console.error('[/api/dashboard/best-performers]', err)
    return buildApiError('Failed to load best performers data')
  }
}
