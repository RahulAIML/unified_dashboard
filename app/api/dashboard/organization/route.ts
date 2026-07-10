import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDashboardOrganization } from '@/lib/bridge-pharma-analytics'
import { isDemoMode } from '@/lib/demo'

export const runtime = 'nodejs'

const EMPTY = { totalMembers: 0, totalAdmins: 0, totalSupervisors: 0, members: [], admins: [] }

// Pharma-sim only — no standard/Banco equivalent exists for org/member rosters.
// No date range — this is current-state org structure, not a time-filtered metric.
export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  if (isDemoMode()) return buildSuccess(EMPTY, { source: 'demo' })

  const orgType = resolveOrgType(ctx.email, ctx.customerId)
  if (orgType !== 'pharma') return buildSuccess(EMPTY)

  try {
    const tenant = resolvePharmaTenant(ctx.email)
    if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

    const data = await pharmaDashboardOrganization(tenant)
    return buildSuccess(data, { source: `pharma-${tenant}` })
  } catch (err) {
    console.error('[/api/dashboard/organization]', err)
    return buildApiError('Failed to load organization data')
  }
}
