import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardOrganization } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppOrganization } from '@/lib/bridge-rolplay-app'
import { isDemoDataEnabled } from '@/lib/demo'
import { demoOrganization } from '@/lib/demo/engine'

export const runtime = 'nodejs'

const EMPTY = { totalMembers: 0, totalAdmins: 0, totalSupervisors: 0, members: [], admins: [] }

// Pharma-sim and rolplay-app tenants only -- no standard/Banco equivalent
// exists for org/member rosters. No date range -- this is current-state
// roster + all-time activity, not a time-filtered metric (see
// rolplayAppOrganization's own docstring for why).
export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  if (isDemoDataEnabled(ctx.email)) return buildSuccess(demoOrganization(), { source: 'demo' })

  const orgType = await resolveOrgType(ctx.email, ctx.customerId)

  try {
    if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenantAccess(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

      const data = await pharmaDashboardOrganization(tenant)
      return buildSuccess(data, { source: `pharma-${tenant}` })
    }

    if (orgType === 'rolplay-app') {
      const clientId = await resolveRolplayAppAccess(ctx.email)
      if (!clientId) return buildApiError('Rolplay-app client could not be resolved', 500)

      const data = await rolplayAppOrganization(clientId)
      return buildSuccess(data, { source: `rolplay-app-${clientId}` })
    }

    return buildSuccess(EMPTY)
  } catch (err) {
    console.error('[/api/dashboard/organization]', err)
    return buildApiError('Failed to load organization data')
  }
}
