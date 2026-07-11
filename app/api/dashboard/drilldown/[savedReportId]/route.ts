import { NextRequest } from 'next/server'
import { getDrilldown } from '@/lib/data-provider'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDashboardDrilldown } from '@/lib/bridge-pharma-analytics'
import { isDemoMode } from '@/lib/demo'
import { getDemoReport } from '@/lib/demo/reports'
import { DEMO_REPORT_IDS } from '@/lib/demo/engine'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ savedReportId: string }> }
) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  try {
    const { savedReportId } = await params
    const id = Number(savedReportId)
    if (isNaN(id)) return buildApiError('Invalid report ID', 400)

    // ── DEMO MODE ────────────────────────────────────────────────────────────
    if (isDemoMode()) {
      // Map any ID into the demo report pool so all drilldown links work
      const demoId = DEMO_REPORT_IDS[id % DEMO_REPORT_IDS.length] ?? DEMO_REPORT_IDS[0]
      const report = getDemoReport(demoId)
      if (!report) return buildApiError('Demo report not found', 404)
      // Return with the originally requested ID so the URL stays correct
      return buildSuccess({ ...report, savedReportId: id }, { savedReportId: id, source: 'demo' })
    }

    const orgType = await resolveOrgType(ctx.email, ctx.customerId)
    if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenant(ctx.email)
      if (!tenant) return buildApiError('Pharma tenant could not be resolved', 500)

      const data = await pharmaDashboardDrilldown(tenant, id)
      if (!data) return buildApiError('Report not found', 404)

      return buildSuccess(data, { savedReportId: id, source: `pharma-${tenant}` })
    }

    const data = await getDrilldown(id, ctx.customerId)
    if (!data) return buildApiError('Report not found', 404)

    return buildSuccess(data, { savedReportId: id })
  } catch (err) {
    console.error('[/api/dashboard/drilldown]', err)
    return buildApiError('Failed to load drilldown data')
  }
}

