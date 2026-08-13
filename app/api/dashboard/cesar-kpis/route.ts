/**
 * GET /api/dashboard/cesar-kpis
 *
 * Sugerencia de KPI's Cesar.xlsx, ported to the hand-built dashboard —
 * rolplay-app only (the one connector these were built and verified against
 * real live data for; see lib/bridge-rolplay-app.ts's Cesar KPI functions
 * for the full per-KPI feasibility notes). Every other org type gets an
 * honest empty response, never a guessed value for a data shape that
 * doesn't exist for them.
 */
import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import {
  resolveRolplayAppAccess,
  rolplayAppCesarGroup1,
  rolplayAppCommercialDomain,
  rolplayAppRubricaTags,
  rolplayAppAdoptionMovementRate,
} from '@/lib/bridge-rolplay-app'

export const runtime = 'nodejs'

const EMPTY = {
  activationRate: null, prevActivationRate: null,
  weeklyPracticeFrequency: null, prevWeeklyPracticeFrequency: null,
  mauRate: null, prevMauRate: null,
  deltaScore: null, prevDeltaScore: null,
  readinessIndex: null, prevReadinessIndex: null,
  masteryDistribution: [] as { label: string; value: number; pct: number }[],
  adoptionMovementRate: null as number | null, prevAdoptionMovementRate: null as number | null,
  commercialDomain: [] as { domain: string; avgScore: number; sessions: number }[],
  topStrengths: [] as { item: string; count: number }[],
  topOpportunities: [] as { item: string; count: number }[],
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  const orgType = await resolveOrgType(ctx.email, ctx.customerId)
  if (orgType !== 'rolplay-app') return buildSuccess(EMPTY, { source: 'not-rolplay-app' })

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400)
    }
    const solution = sp.get('solution')

    const clientId = await resolveRolplayAppAccess(ctx.email)
    if (!clientId) return buildApiError('Rolplay-app client could not be resolved', 500)

    const rangeIso = { fromIso: range.from.toISOString(), toIso: range.to.toISOString() }

    // Previous period = the equal-length window immediately before `from`,
    // mirroring app/api/dashboard/overview/route.ts -- gives the 6 scalar
    // KPI cards a real period-over-period delta instead of a fabricated trend.
    const spanMs   = Math.max(0, range.to.getTime() - range.from.getTime())
    const prevTo   = new Date(range.from.getTime() - 1)
    const prevFrom = new Date(prevTo.getTime() - spanMs)
    const prevRangeIso = { fromIso: prevFrom.toISOString(), toIso: prevTo.toISOString() }

    const [group1, prevGroup1, adoptionMovementRate, prevAdoptionMovementRate, commercialDomain, topStrengths, topOpportunities] = await Promise.all([
      rolplayAppCesarGroup1(clientId, rangeIso, solution),
      rolplayAppCesarGroup1(clientId, prevRangeIso, solution),
      rolplayAppAdoptionMovementRate(clientId, rangeIso, solution),
      rolplayAppAdoptionMovementRate(clientId, prevRangeIso, solution),
      rolplayAppCommercialDomain(clientId, rangeIso, solution),
      rolplayAppRubricaTags(clientId, true, rangeIso, solution),
      rolplayAppRubricaTags(clientId, false, rangeIso, solution),
    ])

    return buildSuccess(
      {
        ...group1,
        prevActivationRate: prevGroup1.activationRate,
        prevWeeklyPracticeFrequency: prevGroup1.weeklyPracticeFrequency,
        prevMauRate: prevGroup1.mauRate,
        prevDeltaScore: prevGroup1.deltaScore,
        prevReadinessIndex: prevGroup1.readinessIndex,
        adoptionMovementRate, prevAdoptionMovementRate,
        commercialDomain, topStrengths, topOpportunities,
      },
      { from: range.from.toISOString(), to: range.to.toISOString(), source: `rolplay-app-${clientId}` },
    )
  } catch (err) {
    console.error('[/api/dashboard/cesar-kpis]', err)
    return buildApiError('Failed to load KPIs')
  }
}
