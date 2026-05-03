import { NextRequest } from 'next/server'
import { getDrilldown } from '@/lib/data-provider'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'

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

    const data = await getDrilldown(id, ctx.customerId)
    if (!data) return buildApiError('Report not found', 404)

    return buildSuccess(data, { savedReportId: id })
  } catch (err) {
    console.error('[/api/dashboard/drilldown]', err)
    return buildApiError('Failed to load drilldown data')
  }
}

