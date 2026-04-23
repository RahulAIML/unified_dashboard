import { NextRequest } from "next/server"
import { getDashboardTrends } from "@/lib/data-provider"
import { buildSuccess, buildApiError, parseDateRange, parseUsecaseFilter, parseClientId } from "@/lib/api-utils"
import { applyTenantUsecaseFilter } from "@/lib/tenant"

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams

    const clientId = parseClientId(sp)
    const range = parseDateRange(sp)
    if (!range) {
      return buildApiError(
        "Invalid date range — provide ?from= and ?to= as ISO strings",
        400,
        { from: sp.get("from"), to: sp.get("to"), clientId }
      )
    }

    const { solution, usecaseIds } = parseUsecaseFilter(sp)
    const tenantFilters = applyTenantUsecaseFilter({ usecaseIds, clientId })

    const data = await getDashboardTrends({
      from: range.from,
      to: range.to,
      usecaseIds: tenantFilters.usecaseIds,
      clientId: tenantFilters.clientId,
    })

    return buildSuccess(data, {
      from:       range.from.toISOString(),
      to:         range.to.toISOString(),
      solution,
      usecaseIds: tenantFilters.usecaseIds ?? null,
      clientId: tenantFilters.clientId,
    })
  } catch (err) {
    console.error("[/api/dashboard/trends]", err)
    return buildApiError("Failed to load trend data")
  }
}
