/**
 * combined-export.ts — aggregate data from all solutions into a single CSV
 */

import { buildCsv, downloadCsv, csvFilename } from "./csv-export"

export interface CombinedExportRow {
  solution: string
  from: string
  to: string
  totalEvaluations: number
  avgScore: number | null
  passRate: number | null
  passedEvaluations: number
  prevTotalEvaluations: number
  prevAvgScore: number | null
  prevPassRate: number | null
  deltaTotalEvaluations: number
  deltaAvgScore: number
  deltaPassRate: number
  deltaPassedEvaluations: number
}

/**
 * Create combined CSV from multiple solutions' KPI data
 * Aggregates: Overview, Certification, Coach, LMS, Simulator, Second Brain
 */
export function createCombinedExport(
  rows: CombinedExportRow[],
  filename: string = csvFilename("combined-dashboard-export")
) {
  const csv = buildCsv(rows, [
    { header: "Solution", value: (r) => r.solution },
    { header: "Period From", value: (r) => r.from },
    { header: "Period To", value: (r) => r.to },
    { header: "Total Evaluations", value: (r) => r.totalEvaluations },
    { header: "Avg Score (pts)", value: (r) => r.avgScore !== null ? r.avgScore.toFixed(2) : "" },
    { header: "Pass Rate (%)", value: (r) => r.passRate !== null ? r.passRate.toFixed(1) : "" },
    { header: "Passed Evaluations", value: (r) => r.passedEvaluations },
    { header: "Prev Total Evaluations", value: (r) => r.prevTotalEvaluations },
    { header: "Prev Avg Score (pts)", value: (r) => r.prevAvgScore !== null ? r.prevAvgScore.toFixed(2) : "" },
    { header: "Prev Pass Rate (%)", value: (r) => r.prevPassRate !== null ? r.prevPassRate.toFixed(1) : "" },
    { header: "Δ Total (%)", value: (r) => r.deltaTotalEvaluations.toFixed(1) },
    { header: "Δ Avg Score (%)", value: (r) => r.deltaAvgScore.toFixed(1) },
    { header: "Δ Pass Rate (%)", value: (r) => r.deltaPassRate.toFixed(1) },
    { header: "Δ Passed (%)", value: (r) => r.deltaPassedEvaluations.toFixed(1) },
  ])

  downloadCsv(csv, filename)
}
