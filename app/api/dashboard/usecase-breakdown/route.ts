import { NextRequest } from "next/server"
import { getUsecaseBreakdown } from "@/lib/data-provider"
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

    const rows = await getUsecaseBreakdown({
      from: range.from,
      to: range.to,
      usecaseIds: tenantFilters.usecaseIds,
      clientId: tenantFilters.clientId,
    })

    return buildSuccess(
      { data: rows },
      {
        from:       range.from.toISOString(),
        to:         range.to.toISOString(),
        solution,
        usecaseIds: tenantFilters.usecaseIds ?? null,
        clientId: tenantFilters.clientId,
      }
    )
  } catch (err) {
    console.error("[/api/dashboard/usecase-breakdown]", err)
    return buildApiError("Failed to load usecase breakdown")
  }
}
