/**
 * useCombinedExport.ts — hook to fetch and export all solutions' data
 */

import { useCallback, useState } from "react"
import { buildApiUrl } from "./useApi"
import { useDashboardStore } from "@/lib/store"
import { createCombinedExport, type CombinedExportRow } from "@/lib/combined-export"
import { calcDeltaPct, estimatePassedSessions } from "@/lib/kpi-builder"
import type { OverviewApiResponse } from "@/lib/types"

const SOLUTIONS = ["overview", "certification", "coach", "lms", "simulator", "second-brain"]

interface CombinedExportState {
  loading: boolean
  error: string | null
}

export function useCombinedExport() {
  const { dateRange, refreshKey } = useDashboardStore()
  const [state, setState] = useState<CombinedExportState>({ loading: false, error: null })

  const exportAllSolutions = useCallback(async () => {
    setState({ loading: true, error: null })

    try {
      const rows: CombinedExportRow[] = []

      // Fetch each solution's overview data
      for (const solution of SOLUTIONS) {
        const url = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, {
          solution: solution === "overview" ? undefined : solution,
          rk: refreshKey,
        })

        // Use native fetch since we need to fetch multiple URLs
        const response = await fetch(url)
        if (!response.ok) continue

        const json = await response.json()

        // Unwrap API contract if needed
        let data: OverviewApiResponse | null = null
        if (json && typeof json === "object" && "success" in json && "data" in json) {
          if (json.success) {
            data = json.data as OverviewApiResponse
          }
        } else {
          data = json as OverviewApiResponse
        }

        if (!data) continue

        // Build row
        rows.push({
          solution: solution.charAt(0).toUpperCase() + solution.slice(1).replace("-", " "),
          from: dateRange.from.toISOString().split("T")[0],
          to: dateRange.to.toISOString().split("T")[0],
          totalEvaluations: data.totalEvaluations,
          avgScore: data.avgScore,
          passRate: data.passRate,
          passedEvaluations: data.passedEvaluations,
          prevTotalEvaluations: data.prevTotalEvaluations,
          prevAvgScore: data.prevAvgScore,
          prevPassRate: data.prevPassRate,
          deltaTotalEvaluations: calcDeltaPct(data.totalEvaluations, data.prevTotalEvaluations),
          deltaAvgScore: calcDeltaPct(data.avgScore ?? 0, data.prevAvgScore ?? 0, 1),
          deltaPassRate: calcDeltaPct(data.passRate ?? 0, data.prevPassRate ?? 0, 1),
          deltaPassedEvaluations: calcDeltaPct(
            data.passedEvaluations,
            estimatePassedSessions(data.prevTotalEvaluations, data.prevPassRate)
          ),
        })
      }

      if (rows.length === 0) {
        setState({ loading: false, error: "No data available to export" })
        return
      }

      // Create and download combined CSV
      createCombinedExport(rows)
      setState({ loading: false, error: null })
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to export combined data",
      })
    }
  }, [dateRange, refreshKey])

  return { ...state, exportAllSolutions }
}
