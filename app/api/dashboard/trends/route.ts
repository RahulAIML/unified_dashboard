import { NextRequest } from "next/server"
import { getDashboardTrends } from "@/lib/data-provider"
import { buildSuccess, buildApiError, parseDateRange, parseUsecaseFilter, parseClientId } from "@/lib/api-utils"

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams

    const range = parseDateRange(sp)
    if (!range) return buildApiError("Invalid date range — provide ?from= and ?to= as ISO strings", 400)

    const { solution, usecaseIds } = parseUsecaseFilter(sp)
    const clientId                 = parseClientId(sp)

    const data = await getDashboardTrends({ from: range.from, to: range.to, usecaseIds })

    return buildSuccess(data, {
      from:       range.from.toISOString(),
      to:         range.to.toISOString(),
      solution,
      usecaseIds: usecaseIds ?? null,
      clientId,
    })
  } catch (err) {
    console.error("[/api/dashboard/trends]", err)
    return buildApiError("Failed to load trend data")
  }
}
