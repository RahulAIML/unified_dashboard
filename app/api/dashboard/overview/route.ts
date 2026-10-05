import { NextRequest } from 'next/server'
import { getDashboardOverview } from '@/lib/data-provider'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveDynamicUsecaseIds } from '@/lib/dynamic-usecase-resolver'
import { resolveOrgType } from '@/lib/org-type'
import { bancoOverviewFromSecondBrain } from '@/lib/banco-second-brain'
import { resolveRolplayAppAccess, rolplayAppOverview } from '@/lib/bridge-rolplay-app'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { resolveDataSources, fetchOverview } from '@/lib/data-sources'
import { isDemoDataEnabled } from '@/lib/demo'
import { demoOverview } from '@/lib/demo/engine'

export const runtime = 'nodejs'

const EMPTY = {
  totalEvaluations: 0, prevTotalEvaluations: 0,
  avgScore: null,      prevAvgScore: null,
  passRate: null,      prevPassRate: null,
  passedEvaluations: 0,
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // ── DEMO MODE ──────────────────────────────────────────────────────────────
  if (isDemoDataEnabled(ctx.email)) {
    const sp    = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) return buildApiError('Invalid date range', 400)
    const sol   = sp.get('solution')
    if (sol === 'second-brain') return buildSuccess(EMPTY, { source: 'demo' })
    return buildSuccess(demoOverview(range.from, range.to, sol), { source: 'demo' })
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

    // ── Banco pipeline (Second Brain-backed) ──────────────────────────────────
    // Banco-domain orgs (coppel/bancoppel) aren't in coach_app.coach_users, so
    // the SQL banco pipeline returns empty for them. Their real data is in
    // Second Brain — route Overview there. See lib/banco-second-brain.ts.
    if (orgType === 'banco') {
      const data = await bancoOverviewFromSecondBrain(ctx.email, ctx.customerId)
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(),
        source: 'banco-second-brain',
      })
    }

    // ── Pharma-sim pipeline (Sanfer, Apotex, …) ───────────────────────────────
    if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenantAccess(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

      const spanMs   = Math.max(0, range.to.getTime() - range.from.getTime())
      const prevTo   = new Date(range.from.getTime() - 1)
      const prevFrom = new Date(prevTo.getTime() - spanMs)

      // Rolplay App SQL is the PRIMARY source wherever it genuinely exists
      // for this identity (see lib/data-sources.ts) -- a pharma tenant's
      // real users can ALSO be real users of a distinct rolplay_app_sql
      // client_id (verified for M8: arceralifesciences.com reps exist in
      // both pharma_exceltis_rest and rolplay_app_sql client_id=24 -- two
      // real systems, the same real people). Composed into the tenant-wide
      // Overview rather than silently hiding one; module tabs stay on the
      // existing single-source resolvePharmaTenantAccess path below,
      // untouched. Driven purely by whether a secondary source resolves for
      // this email, not a tenant-name check, so it applies automatically to
      // any tenant wired the same way with zero effect on every tenant that
      // isn't.
      const sources = await resolveDataSources(ctx.email, tenant, solution)
      const result = await fetchOverview(sources, {
        fromIso:     range.from.toISOString(),
        toIso:       range.to.toISOString(),
        prevFromIso: prevFrom.toISOString(),
        prevToIso:   prevTo.toISOString(),
      }, solution)
      if (!result) return buildApiError('Pharma tenant could not be resolved', 500)

      return buildSuccess(result.data, {
        from: range.from.toISOString(), to: range.to.toISOString(),
        solution, source: result.source,
      })
    }

    // ── Rolplay-app platform (counts-only; scores not captured) ───────────────
    if (orgType === 'rolplay-app') {
      const clientId = await resolveRolplayAppAccess(ctx.email)
      if (!clientId) return buildApiError('Rolplay-app client could not be resolved', 500)
      const data = await rolplayAppOverview(clientId, {
        fromIso: range.from.toISOString(), toIso: range.to.toISOString(),
      }, solution)
      return buildSuccess(data, {
        from: range.from.toISOString(), to: range.to.toISOString(),
        source: `rolplay-app-${clientId}`,
      })
    }

    // ── Standard analytics pipeline ───────────────────────────────────────────
    const idsParam   = sp.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : await resolveDynamicUsecaseIds(ctx.customerId, solution)

    const data = await getDashboardOverview({
      from: range.from, to: range.to, usecaseIds, customerId: ctx.customerId,
    })

    return buildSuccess(data, {
      from:       range.from.toISOString(),
      to:         range.to.toISOString(),
      solution,
      usecaseIds: usecaseIds ?? null,
    })
  } catch (err) {
    console.error('[/api/dashboard/overview]', err)
    return buildApiError('Failed to load overview data')
  }
}
