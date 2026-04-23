import { NextRequest } from "next/server"
import { getDrilldown } from "@/lib/data-provider"
import { buildSuccess, buildApiError, parseClientId } from "@/lib/api-utils"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ savedReportId: string }> }
) {
  try {
    const { savedReportId } = await params
    const id       = Number(savedReportId)
    const clientId = parseClientId(request.nextUrl.searchParams)

    if (isNaN(id)) {
      return buildApiError("Invalid report ID", 400)
    }

    const data = await getDrilldown(id)

    if (!data) {
      return buildApiError("Report not found", 404)
    }

    return buildSuccess(data, { savedReportId: id, clientId })
  } catch (err) {
    console.error("[/api/dashboard/drilldown]", err)
    return buildApiError("Failed to load drilldown data")
  }
}
