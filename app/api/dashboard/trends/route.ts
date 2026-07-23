import { NextRequest } from 'next/server'
import { getDashboardTrends } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardTrends } from '@/lib/bridge-banco-analytics'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDashboardTrends } from '@/lib/bridge-pharma-analytics'
import { isDemoMode } from '@/lib/demo'
import { demoTrends } from '@/lib/demo/engine'
import { bucketTrends, bucketTrend, attachPreviousScore, isGranularity, type Granularity } from '@/lib/trend-transform'
import type { TrendsApiResponse } from '@/lib/types'

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

  const orgType = await resolveOrgType(ctx.email, ctx.customerId)
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

    const granularity: Granularity = isGranularity(sp.get('granularity')) ? sp.get('granularity') as Granularity : 'daily'
    const compare = sp.get('compare') === '1'

    // Resolve the pipeline ONCE into a fetcher over an arbitrary window, so the
    // previous-period overlay and granularity bucketing below are applied
    // generically — identical for banco / pharma / standard, no per-pipeline code.
    let source: string
    let fetchTrends: (from: Date, to: Date) => Promise<TrendsApiResponse>

    if (orgType === 'banco') {
      source = 'banco'
      fetchTrends = (from, to) => bancoDashboardTrends({ fromIso: from.toISOString(), toIso: to.toISOString() })
    } else if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenant(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)
      source = `pharma-${tenant}`
      fetchTrends = (from, to) => pharmaDashboardTrends(tenant, { fromIso: from.toISOString(), toIso: to.toISOString(), solution })
    } else {
      const idsParam = sp.get('usecaseIds')
      const usecaseIds = idsParam
        ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
        : await resolveDynamicUsecaseIds(ctx.customerId, solution)
      source = 'standard'
      fetchTrends = (from, to) => getDashboardTrends({ from, to, usecaseIds, customerId: ctx.customerId })
    }

    let data = bucketTrends(await fetchTrends(range.from, range.to), granularity)

    // Previous period = equal-length window immediately before `from`; overlay
    // its (bucketed) score series as value2 for a this-vs-previous chart.
    if (compare) {
      const len = range.to.getTime() - range.from.getTime()
      const prev = await fetchTrends(new Date(range.from.getTime() - len), range.from).catch(() => null)
      if (prev) data = attachPreviousScore(data, bucketTrend(prev.scoreTrend, granularity, 'avg'))
    }

    return buildSuccess(data, {
      from: range.from.toISOString(), to: range.to.toISOString(),
      solution, source, granularity, compared: compare,
    })
  } catch (err) {
    console.error('[/api/dashboard/trends]', err)
    return buildApiError('Failed to load trend data')
  }
}
