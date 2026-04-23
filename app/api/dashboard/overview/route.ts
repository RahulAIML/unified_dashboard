import { NextRequest } from "next/server"
import { getDashboardOverview } from "@/lib/data-provider"
import { buildSuccess, buildApiError, parseDateRange, parseUsecaseFilter, parseClientId } from "@/lib/api-utils"

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams

    const range = parseDateRange(sp)
    if (!range) return buildApiError("Invalid date range — provide ?from= and ?to= as ISO strings", 400)

    const { solution, usecaseIds } = parseUsecaseFilter(sp)
    const clientId                 = parseClientId(sp)

    const data = await getDashboardOverview({ from: range.from, to: range.to, usecaseIds })

    return buildSuccess(data, {
      from:       range.from.toISOString(),
      to:         range.to.toISOString(),
      solution,
      usecaseIds: usecaseIds ?? null,
      clientId,
    })
  } catch (err) {
    console.error("[/api/dashboard/overview]", err)
    return buildApiError("Failed to load overview data")
  }
}
