import { NextRequest } from 'next/server'
import { getEvaluationResults } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardResults } from '@/lib/bridge-banco-analytics'
import { isDemoMode } from '@/lib/demo'
import { demoResults } from '@/lib/demo/engine'

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
    const lim   = Math.min(Number(sp.get('limit') ?? 20), 200)
    return buildSuccess(demoResults(range.from, range.to, lim, sol), { source: 'demo' })
  }

  const orgType = resolveOrgType(ctx.email, ctx.customerId)
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
    const limit    = Math.min(Number(sp.get('limit') ?? 50), 200)

    if (solution === 'second-brain') {
      return buildSuccess({ data: [] }, { solution, source: 'second-brain-api-only' })
    }

    // ── Banco pipeline ────────────────────────────────────────────────────────
    if (orgType === 'banco') {
      const data = await bancoDashboardResults({
        fromIso: range.from.toISOString(),
        toIso:   range.to.toISOString(),
        limit,
      })
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(), source: 'banco', limit,
      })
    }

    // ── Standard analytics pipeline ───────────────────────────────────────────
    const idsParam   = sp.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : await resolveDynamicUsecaseIds(ctx.customerId, solution)

    const rows = await getEvaluationResults(
      { from: range.from, to: range.to, usecaseIds, customerId: ctx.customerId },
      limit
    )

    return buildSuccess(
      { data: rows },
      { from: range.from.toISOString(), to: range.to.toISOString(), solution, usecaseIds: usecaseIds ?? null, limit }
    )
  } catch (err) {
    console.error('[/api/dashboard/results]', err)
    return buildApiError('Failed to load evaluation results')
  }
}
