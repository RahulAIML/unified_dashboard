/**
 * Data provider — server-side only.
 *
 * All queries target the rolplay_pro_analytics database.
 * Tables used:
 *   report_field_current   — flattened JSON fields (field_key, value_num, value_text, value_longtext)
 *   report_payload_current — raw closing_json payload (for drill-down)
 *
 * Field-key → KPI mapping (derived from screenshots):
 *   overall_score       → value_num  : evaluation score (0–100)
 *   overall_result      → value_text : "Deficiente" = FAIL, anything else = PASS
 *   overall_assessment  → value_longtext : narrative summary
 *   strengths           → value_longtext : strengths narrative
 *   areas_for_improvement → value_longtext : improvement areas
 *   final_recommendations → value_longtext : recommendations
 *   c{n}_{cat}_score    → value_num  : category score (0–10)
 *   c{n}_{cat}_justification / _improvement / _recommendation → value_text / longtext
 *
 * Pass/Fail logic:
 *   PASS = overall_result IS NOT NULL AND overall_result != 'Deficiente'
 *   FAIL = overall_result = 'Deficiente'
 */

import { query } from './db'

// ─── Filter shape ─────────────────────────────────────────────────────────────

export interface AnalyticsFilters {
  from: Date
  to:   Date
  /** Filter by usecase_id. Empty array = no filter (all usecases). */
  usecaseIds?: number[]
}

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface OverviewKpis {
  totalEvaluations:     number
  avgScore:             number | null
  passRate:             number | null   // 0–100
  passedEvaluations:    number
  // prior-period values for delta calculation
  prevTotalEvaluations: number
  prevAvgScore:         number | null
  prevPassRate:         number | null
}

export interface TrendPoint {
  date:   string   // YYYY-MM-DD
  value:  number
  value2?: number  // for pass/fail stacked: value=passed, value2=failed
}

export interface TrendsResult {
  scoreTrend:    TrendPoint[]
  passFailTrend: TrendPoint[]
  evalCountTrend: TrendPoint[]
}

export interface EvaluationRow {
  savedReportId: number
  usecaseId:     number | null
  score:         number | null
  result:        string | null  // e.g. "Deficiente"
  passed:        boolean
  date:          string         // YYYY-MM-DD
}

export interface UsecaseRow {
  usecaseId:       number
  totalEvaluations: number
  avgScore:         number | null
  passRate:         number | null
  passed:           number
}

export interface DrilldownField {
  fieldKey:      string
  fieldLabel:    string | null
  valueNum:      number | null
  valueText:     string | null
  valueLongtext: string | null
}

export interface DrilldownResult {
  savedReportId: number
  usecaseId:     number | null
  date:          string
  fields:        DrilldownField[]
  closingJson:   Record<string, unknown> | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** ISO string for a Date without timezone noise */
function fmtDatetime(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

/** Compute prior period: same duration, immediately before `from` */
function priorPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime()
  return {
    from: new Date(from.getTime() - span),
    to:   new Date(from.getTime() - 1),
  }
}

/** Build an optional usecase_id IN clause and parameter array. */
function usecaseClause(
  usecaseIds: number[] | undefined,
  alias = 'rfc'
): { clause: string; params: number[] } {
  if (!usecaseIds || usecaseIds.length === 0) return { clause: '', params: [] }
  const placeholders = usecaseIds.map(() => '?').join(', ')
  return {
    clause: ` AND ${alias}.usecase_id IN (${placeholders})`,
    params: usecaseIds,
  }
}

// ─── Query: Overview KPIs ─────────────────────────────────────────────────────

export async function getOverviewKpis(
  filters: AnalyticsFilters
): Promise<OverviewKpis> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)
  const prior = priorPeriod(from, to)

  async function fetchPeriod(pFrom: Date, pTo: Date) {
    const dateParams = [fmtDatetime(pFrom), fmtDatetime(pTo)]

    // Total evaluations + avg score in one pass
    const scoreRows = await query<{ total: number; avg_score: number | null }>(
      `SELECT COUNT(DISTINCT saved_report_id) AS total,
              ROUND(AVG(value_num), 1)        AS avg_score
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_score'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
      [...dateParams, ...ucParams]
    )

    // Pass / fail counts
    const pfRows = await query<{ passed: number; total_res: number }>(
      `SELECT COUNT(CASE WHEN value_text != 'Deficiente' THEN 1 END) AS passed,
              COUNT(*)                                                 AS total_res
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_result'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
      [...dateParams, ...ucParams]
    )

    const total     = scoreRows[0]?.total     ?? 0
    const avgScore  = scoreRows[0]?.avg_score ?? null
    const passed    = pfRows[0]?.passed       ?? 0
    const totalRes  = pfRows[0]?.total_res    ?? 0
    const passRate  = totalRes > 0 ? Math.round((passed / totalRes) * 100 * 10) / 10 : null

    return { total, avgScore, passRate, passed }
  }

  const [current, prev] = await Promise.all([
    fetchPeriod(from, to),
    fetchPeriod(prior.from, prior.to),
  ])

  return {
    totalEvaluations:     current.total,
    avgScore:             current.avgScore,
    passRate:             current.passRate,
    passedEvaluations:    current.passed,
    prevTotalEvaluations: prev.total,
    prevAvgScore:         prev.avgScore,
    prevPassRate:         prev.passRate,
  }
}

// ─── Query: Trends ────────────────────────────────────────────────────────────

export async function getTrends(
  filters: AnalyticsFilters
): Promise<TrendsResult> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)
  const dateParams = [fmtDatetime(from), fmtDatetime(to)]

  const [scoreRows, pfRows, countRows] = await Promise.all([
    // Daily avg score
    query<{ date: string; value: number }>(
      `SELECT DATE(report_created_at)        AS date,
              ROUND(AVG(value_num), 1)       AS value
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_score'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dateParams, ...ucParams]
    ),
    // Daily pass / fail counts
    query<{ date: string; value: number; value2: number }>(
      `SELECT DATE(report_created_at)                                          AS date,
              COUNT(CASE WHEN value_text != 'Deficiente' THEN 1 END)           AS value,
              COUNT(CASE WHEN value_text  = 'Deficiente' THEN 1 END)           AS value2
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_result'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dateParams, ...ucParams]
    ),
    // Daily evaluation count (activity trend)
    query<{ date: string; value: number }>(
      `SELECT DATE(report_created_at)            AS date,
              COUNT(DISTINCT saved_report_id)    AS value
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_score'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dateParams, ...ucParams]
    ),
  ])

  return {
    scoreTrend:     scoreRows,
    passFailTrend:  pfRows,
    evalCountTrend: countRows,
  }
}

// ─── Query: Evaluation results table ─────────────────────────────────────────

export async function getEvaluationResults(
  filters: AnalyticsFilters,
  limit = 50
): Promise<EvaluationRow[]> {
  const { from, to, usecaseIds } = filters
  const { clause: ucS, params: ucSParams } = usecaseClause(usecaseIds, 's')

  const rows = await query<{
    saved_report_id: number
    usecase_id:      number | null
    score:           number | null
    result:          string | null
    report_created_at: string
  }>(
    `SELECT s.saved_report_id,
            s.usecase_id,
            s.value_num                    AS score,
            r.value_text                   AS result,
            DATE(s.report_created_at)      AS report_created_at
     FROM report_field_current s
     LEFT JOIN report_field_current r
            ON s.saved_report_id = r.saved_report_id
           AND r.field_key       = 'overall_result'
     WHERE s.field_key = 'overall_score'
       AND s.report_created_at BETWEEN ? AND ?${ucS}
     ORDER BY s.report_created_at DESC
     LIMIT ?`,
    [fmtDatetime(from), fmtDatetime(to), ...ucSParams, limit]
  )

  return rows.map(r => ({
    savedReportId: r.saved_report_id,
    usecaseId:     r.usecase_id,
    score:         r.score !== null ? Math.round(Number(r.score)) : null,
    result:        r.result,
    passed:        r.result !== null && r.result !== 'Deficiente',
    date:          String(r.report_created_at).slice(0, 10),
  }))
}

// ─── Query: Usecase breakdown ─────────────────────────────────────────────────

export async function getUsecaseBreakdown(
  filters: AnalyticsFilters
): Promise<UsecaseRow[]> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)

  const rows = await query<{
    usecase_id:        number
    total_evaluations: number
    avg_score:         number | null
    passed:            number
    total_results:     number
  }>(
    `SELECT s.usecase_id,
            COUNT(DISTINCT s.saved_report_id)                             AS total_evaluations,
            ROUND(AVG(s.value_num), 1)                                    AS avg_score,
            COUNT(DISTINCT CASE WHEN r.value_text != 'Deficiente'
                                THEN r.saved_report_id END)               AS passed,
            COUNT(DISTINCT r.saved_report_id)                             AS total_results
     FROM report_field_current s
     LEFT JOIN report_field_current r
            ON s.saved_report_id = r.saved_report_id
           AND r.field_key       = 'overall_result'
     WHERE s.field_key = 'overall_score'
       AND s.report_created_at BETWEEN ? AND ?${uc}
     GROUP BY s.usecase_id
     ORDER BY total_evaluations DESC
     LIMIT 20`,
    [fmtDatetime(from), fmtDatetime(to), ...ucParams]
  )

  return rows.map(r => ({
    usecaseId:        r.usecase_id,
    totalEvaluations: r.total_evaluations,
    avgScore:         r.avg_score !== null ? Number(r.avg_score) : null,
    passRate:         r.total_results > 0
                        ? Math.round((r.passed / r.total_results) * 100)
                        : null,
    passed:           r.passed,
  }))
}

// ─── Query: Drill-down ────────────────────────────────────────────────────────

export async function getDrilldown(
  savedReportId: number
): Promise<DrilldownResult | null> {
  const [fieldRows, payloadRows] = await Promise.all([
    query<{
      field_key:       string
      field_label:     string | null
      value_num:       number | null
      value_text:      string | null
      value_longtext:  string | null
      usecase_id:      number | null
      report_created_at: string
    }>(
      `SELECT field_key, field_label, value_num, value_text, value_longtext,
              usecase_id, report_created_at
       FROM report_field_current
       WHERE saved_report_id = ?
       ORDER BY id`,
      [savedReportId]
    ),
    query<{ closing_json: string; report_created_at: string }>(
      `SELECT closing_json, report_created_at
       FROM report_payload_current
       WHERE saved_report_id = ?
       LIMIT 1`,
      [savedReportId]
    ),
  ])

  if (fieldRows.length === 0 && payloadRows.length === 0) return null

  let closingJson: Record<string, unknown> | null = null
  try {
    if (payloadRows[0]?.closing_json) {
      closingJson = JSON.parse(payloadRows[0].closing_json)
    }
  } catch {
    // malformed JSON — leave null
  }

  const first = fieldRows[0] ?? payloadRows[0]

  return {
    savedReportId,
    usecaseId: fieldRows[0]?.usecase_id ?? null,
    date:      String(first?.report_created_at ?? '').slice(0, 10),
    fields:    fieldRows.map(r => ({
      fieldKey:      r.field_key,
      fieldLabel:    r.field_label,
      valueNum:      r.value_num !== null ? Number(r.value_num) : null,
      valueText:     r.value_text,
      valueLongtext: r.value_longtext,
    })),
    closingJson,
  }
}

