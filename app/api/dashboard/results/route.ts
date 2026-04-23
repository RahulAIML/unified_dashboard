import { NextRequest } from "next/server"
import { getEvaluationResults } from "@/lib/data-provider"
import { buildSuccess, buildApiError, parseDateRange, parseUsecaseFilter, parseClientId } from "@/lib/api-utils"

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams

    const range = parseDateRange(sp)
    if (!range) return buildApiError("Invalid date range — provide ?from= and ?to= as ISO strings", 400)

    // Fix: results route now accepts ?solution= the same way overview does
    const { solution, usecaseIds } = parseUsecaseFilter(sp)
    const clientId                 = parseClientId(sp)
    const limit                    = Math.min(Number(sp.get("limit") ?? 50), 200)

    const rows = await getEvaluationResults({ from: range.from, to: range.to, usecaseIds }, limit)

    return buildSuccess(
      { data: rows },
      {
        from:       range.from.toISOString(),
        to:         range.to.toISOString(),
        solution,
        usecaseIds: usecaseIds ?? null,
        limit,
        clientId,
      }
    )
  } catch (err) {
    console.error("[/api/dashboard/results]", err)
    return buildApiError("Failed to load evaluation results")
  }
}
