import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDashboardObjections } from '@/lib/bridge-pharma-analytics'
import { isDemoDataEnabled } from '@/lib/demo'
import { demoObjections } from '@/lib/demo/engine'

export const runtime = 'nodejs'

const EMPTY = { data: [] }

// Pharma-sim only — no standard/Banco equivalent exists for objection-handling data.
export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  if (isDemoDataEnabled(ctx.email)) {
    const range = parseDateRange(request.nextUrl.searchParams)
    return buildSuccess(range ? demoObjections(range.from, range.to) : EMPTY, { source: 'demo' })
  }

  const orgType = await resolveOrgType(ctx.email, ctx.customerId)
  if (orgType !== 'pharma') return buildSuccess(EMPTY)

  try {
    const sp = request.nextUrl.searchParams
    const range = parseDateRange(sp)
    if (!range) return buildApiError('Invalid date range — provide ?from= and ?to= as ISO strings', 400)

    const tenant = await resolvePharmaTenant(ctx.email)
    if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

    const data = await pharmaDashboardObjections(tenant, {
      fromIso: range.from.toISOString(), toIso: range.to.toISOString(),
    })
    return buildSuccess(data, {
      from: range.from.toISOString(), to: range.to.toISOString(), source: `pharma-${tenant}`,
    })
  } catch (err) {
    console.error('[/api/dashboard/objections]', err)
    return buildApiError('Failed to load objections data')
  }
}
