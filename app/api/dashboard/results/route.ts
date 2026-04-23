import { NextRequest } from "next/server"
import { getEvaluationResults } from "@/lib/data-provider"
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

    // Fix: results route now accepts ?solution= the same way overview does
    const { solution, usecaseIds } = parseUsecaseFilter(sp)
    const limit                    = Math.min(Number(sp.get("limit") ?? 50), 200)
    const tenantFilters            = applyTenantUsecaseFilter({ usecaseIds, clientId })

    const rows = await getEvaluationResults(
      { from: range.from, to: range.to, usecaseIds: tenantFilters.usecaseIds, clientId: tenantFilters.clientId },
      limit
    )

    return buildSuccess(
      { data: rows },
      {
        from:       range.from.toISOString(),
        to:         range.to.toISOString(),
        solution,
        usecaseIds: tenantFilters.usecaseIds ?? null,
        limit,
        clientId: tenantFilters.clientId,
      }
    )
  } catch (err) {
    console.error("[/api/dashboard/results]", err)
    return buildApiError("Failed to load evaluation results")
  }
}
