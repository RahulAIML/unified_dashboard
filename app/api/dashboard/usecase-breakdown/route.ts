import { NextRequest } from 'next/server'
import { getUsecaseBreakdown } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange, parseUsecaseFilter } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

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

    const rows = await getUsecaseBreakdown({
      from: range.from,
      to: range.to,
      usecaseIds,
      customerId: ctx.customerId,
    })

    return buildSuccess(
      { data: rows },
      {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        solution,
        usecaseIds: usecaseIds ?? null,
      }
    )
  } catch (err) {
    console.error('[/api/dashboard/usecase-breakdown]', err)
    return buildApiError('Failed to load usecase breakdown')
  }
}

