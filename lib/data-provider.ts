/**
 * data-provider.ts — server-side only data layer.
 *
 * Design principles:
 *  1. safeQuery()     — wraps every DB call; returns null on ANY error, never throws
 *  2. fieldInClause() — resolves inconsistent field_key names (DB-1 fix)
 *  3. normalizeScore()— converts 0-10 scores to 0-100 before KPI calc (DB-2 fix)
 *  4. DB probe cache  — health-checks DB once per 30 s; result cached in memory
 *  5. Auto-fallback   — every exported function returns safe empty data on failure
 *  6. Opaque API      — callers never see "DB error" or "fallback" in the response
 */

import { query }                from "./db"
import { fieldInClause }        from "./field-map"
import { computePassRate, normalizeResult, normalizeScore, safeNumber, safeString } from "./kpi-builder"
import { applyTenantUsecaseFilter, canClientAccessUsecase } from "./tenant"
import type { DateRange }       from "./types"

// Explicit re-export so routes can import types from a single place
export type { DateRange }

// ── Env switch ────────────────────────────────────────────────────────────────
const USE_REAL_DB = process.env.USE_REAL_DB !== "false"

// ── Public types ──────────────────────────────────────────────────────────────

export interface AnalyticsFilters {
  from: Date
  to:   Date
  /** Filter by usecase_id. Empty / undefined = no filter (all usecases). */
  usecaseIds?: number[]
  /** Logical multi-tenant filter (usecase_id mapping), Phase 1. */
  clientId?: string | null
}

export interface OverviewKpis {
  totalEvaluations:     number
  avgScore:             number | null  // normalised 0-100
  passRate:             number | null  // 0-100
  passedEvaluations:    number
  prevTotalEvaluations: number
  prevAvgScore:         number | null
  prevPassRate:         number | null
}

export interface TrendPoint {
  date:    string      // YYYY-MM-DD
  value:   number
  value2?: number      // pass/fail stacked: value=passed, value2=failed
}

export interface TrendsResult {
  scoreTrend:     TrendPoint[]
  passFailTrend:  TrendPoint[]
  evalCountTrend: TrendPoint[]
}

export interface EvaluationRow {
  savedReportId: number
  usecaseId:     number | null
  score:         number | null  // normalised 0-100
  result:        string | null
  passed:        boolean
  date:          string         // YYYY-MM-DD
}

export interface UsecaseRow {
  usecaseId:        number
  totalEvaluations: number
  avgScore:         number | null  // normalised 0-100
  passRate:         number | null
  passed:           number
}

export interface DrilldownField {
  fieldKey:        string
  fieldLabel:      string | null
  valueNum:        number | null
  valueText:       string | null
  valueLongtext:   string | null
  /** Best resolved value: value_num → value_text → value_longtext → null */
  normalizedValue: number | string | null
}

export interface DrilldownResult {
  savedReportId: number
  usecaseId:     number | null
  date:          string
  fields:        DrilldownField[]
  closingJson:   Record<string, unknown> | null
}

// ── normalizeField ────────────────────────────────────────────────────────────

export interface RawFieldRow {
  field_key:      string
  value_num?:     number | string | null
  value_text?:    string | null
  value_longtext?: string | null
}

/**
 * Resolves the best value from a report_field_current row.
 * Priority: value_num → value_text → value_longtext → null
 */
export function normalizeField(row: RawFieldRow): {
  key: string
  value: number | string | null
} {
  let value: number | string | null = null

  if (row.value_num !== undefined && row.value_num !== null) {
    value = safeNumber(row.value_num)
  }

  if (value === null) {
    value = safeString(row.value_text)
  }

  if (value === null) {
    value = safeString(row.value_longtext)
  }

  return { key: row.field_key, value }
}

// ── safeQuery ─────────────────────────────────────────────────────────────────

async function safeQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[] | null> {
  try {
    return await query<T>(sql, params)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code ?? ""
    const msg  = (err as Error).message ?? String(err)

    if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENOTFOUND") {
      console.warn("⚠️  DB unreachable:", code)
    } else if (msg.includes("ER_ACCESS_DENIED")) {
      console.warn("⚠️  DB access denied")
    } else {
      console.warn("⚠️  DB error:", msg)
    }

    return null
  }
}

// ── DB availability probe ─────────────────────────────────────────────────────

let _dbAvailable: boolean | null = null
let _dbProbeAt   = 0
const PROBE_TTL  = 30_000

async function isDbAvailable(): Promise<boolean> {
  if (!USE_REAL_DB) return false

  const now = Date.now()
  if (_dbAvailable !== null && now - _dbProbeAt < PROBE_TTL) return _dbAvailable

  const rows = await safeQuery<{ ok: number }>("SELECT 1 AS ok")
  _dbAvailable = rows !== null
  _dbProbeAt   = now

  if (_dbAvailable) console.info("✅ DB connection healthy")

  return _dbAvailable
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function fmtDatetime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19)
}

function priorPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime()
  return {
    from: new Date(from.getTime() - span),
    to:   new Date(from.getTime() - 1),
  }
}

function usecaseClause(
  usecaseIds: number[] | undefined,
  alias = "rfc"
): { clause: string; params: number[] } {
  if (!usecaseIds) return { clause: "", params: [] }
  if (usecaseIds.length === 0) return { clause: " AND 1=0", params: [] }
  const placeholders = usecaseIds.map(() => "?").join(", ")
  return {
    clause: ` AND ${alias}.usecase_id IN (${placeholders})`,
    params: usecaseIds,
  }
}

function withTenant(filters: AnalyticsFilters): AnalyticsFilters {
  return applyTenantUsecaseFilter(filters) as AnalyticsFilters
}

// ── Empty fallbacks ───────────────────────────────────────────────────────────

function emptyOverview(): OverviewKpis {
  return {
    totalEvaluations:     0,
    avgScore:             null,
    passRate:             null,
    passedEvaluations:    0,
    prevTotalEvaluations: 0,
    prevAvgScore:         null,
    prevPassRate:         null,
  }
}

function emptyTrends(): TrendsResult {
  return { scoreTrend: [], passFailTrend: [], evalCountTrend: [] }
}

// ── Real DB: overview KPIs ────────────────────────────────────────────────────
//
// DB-1 fix: every field_key filter uses fieldInClause() to catch all aliases.
// DB-2 fix: normalizeScore() applied to every avg_score before returning.

async function getOverviewKpisReal(
  filters: AnalyticsFilters
): Promise<OverviewKpis | null> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)
  const prior = priorPeriod(from, to)

  // Score field clause — covers 'overall_score' and 'final_score'
  const scoreIn  = fieldInClause("score")
  // Result field clause — covers 'overall_result' and 'status'
  const resultIn = fieldInClause("result")

  async function fetchPeriod(pFrom: Date, pTo: Date) {
    const dp = [fmtDatetime(pFrom), fmtDatetime(pTo)]

    // Total distinct sessions in the period (not gated on having a score field)
    const totalRows = await safeQuery<{ total: number }>(
      `SELECT COUNT(DISTINCT saved_report_id) AS total
       FROM report_field_current rfc
       WHERE rfc.report_created_at BETWEEN ? AND ?${uc}`,
      [...dp, ...ucParams]
    )
    if (!totalRows) return null

    // Avg score — any row whose field_key is in the score alias list
    const scoreRows = await safeQuery<{ avg_score: number | null }>(
      `SELECT ROUND(AVG(value_num), 2) AS avg_score
       FROM report_field_current rfc
       WHERE ${scoreIn}
         AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
      [...dp, ...ucParams]
    )
    if (!scoreRows) return null

    // Pass / fail counts — any row whose field_key is in the result alias list
    const pfRows = await safeQuery<{ passed: number; total_res: number }>(
      `SELECT COUNT(CASE WHEN TRIM(value_text) != 'Deficiente' THEN 1 END) AS passed,
              COUNT(*)                                                 AS total_res
       FROM report_field_current rfc
       WHERE ${resultIn}
         AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
      [...dp, ...ucParams]
    )
    if (!pfRows) return null

    const total    = Number(totalRows[0]?.total    ?? 0)
    const rawAvg   = pfRows[0] ? (scoreRows[0]?.avg_score ?? null) : null
    const passed   = Number(pfRows[0]?.passed    ?? 0)
    const totalRes = Number(pfRows[0]?.total_res ?? 0)
    const passRate = totalRes > 0
      ? Math.round((passed / totalRes) * 100 * 10) / 10
      : null

    return { total, avgScore: normalizeScore(rawAvg), passRate, passed }
  }

  const [current, prev] = await Promise.all([
    fetchPeriod(from, to),
    fetchPeriod(prior.from, prior.to),
  ])

  if (!current || !prev) return null

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

// ── Real DB: trends ───────────────────────────────────────────────────────────

async function getTrendsReal(
  filters: AnalyticsFilters
): Promise<TrendsResult | null> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)
  const dp = [fmtDatetime(from), fmtDatetime(to)]

  const scoreIn  = fieldInClause("score")
  const resultIn = fieldInClause("result")

  const [scoreRows, pfRows, countRows] = await Promise.all([
    safeQuery<{ date: string; value: number }>(
      `SELECT DATE(report_created_at)  AS date,
              ROUND(AVG(value_num), 1) AS value
       FROM report_field_current rfc
       WHERE ${scoreIn}
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dp, ...ucParams]
    ),
    safeQuery<{ date: string; value: number; value2: number }>(
      `SELECT DATE(report_created_at)                                   AS date,
              COUNT(CASE WHEN TRIM(value_text) != 'Deficiente' THEN 1 END)    AS value,
              COUNT(CASE WHEN TRIM(value_text)  = 'Deficiente' THEN 1 END)    AS value2
       FROM report_field_current rfc
       WHERE ${resultIn}
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dp, ...ucParams]
    ),
    safeQuery<{ date: string; value: number }>(
      `SELECT DATE(report_created_at)         AS date,
              COUNT(DISTINCT saved_report_id) AS value
       FROM report_field_current rfc
       WHERE rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dp, ...ucParams]
    ),
  ])

  if (!scoreRows || !pfRows || !countRows) return null

  // Normalise scores in the trend series
  const normalisedScoreTrend = scoreRows.map((r) => ({
    date:  r.date,
    value: normalizeScore(r.value) ?? 0,
  }))

  return {
    scoreTrend:     normalisedScoreTrend,
    passFailTrend:  pfRows,
    evalCountTrend: countRows,
  }
}

// ── Real DB: evaluation results list ─────────────────────────────────────────

async function getEvaluationResultsReal(
  filters: AnalyticsFilters,
  limit = 50
): Promise<EvaluationRow[] | null> {
  const { from, to, usecaseIds } = filters
  const { clause: ucBase, params: ucParams } = usecaseClause(usecaseIds, "base")

  const scoreIn  = fieldInClause("score",  "sc.field_key")
  const resultIn = fieldInClause("result", "r.field_key")

  const rows = await safeQuery<{
    saved_report_id:    number
    usecase_id:         number | null
    score:              number | null
    result:             string | null
    report_created_at:  string
  }>(
    // Drive from all distinct sessions; LEFT JOINs so sessions without a score
    // field still appear in the list.
    `SELECT base.saved_report_id,
            base.usecase_id,
            sc.value_num               AS score,
            r.value_text               AS result,
            DATE(base.report_created_at) AS report_created_at
     FROM (
       SELECT DISTINCT saved_report_id, usecase_id, report_created_at
       FROM report_field_current
       WHERE report_created_at BETWEEN ? AND ?
     ) base
     LEFT JOIN report_field_current sc
            ON sc.saved_report_id = base.saved_report_id
           AND ${scoreIn}
     LEFT JOIN report_field_current r
            ON r.saved_report_id  = base.saved_report_id
           AND ${resultIn}
     WHERE 1=1${ucBase}
     ORDER BY base.report_created_at DESC
     LIMIT ?`,
    [fmtDatetime(from), fmtDatetime(to), ...ucParams, limit]
  )

  if (!rows) return null

  return rows.map((r) => {
    const normScore = normalizeScore(r.score)
    return {
      savedReportId: r.saved_report_id,
      usecaseId:     r.usecase_id,
      score:         normScore !== null ? Math.round(normScore) : null,
      result:        r.result,
      passed:        normalizeResult(r.result) === "pass",
      date:          String(r.report_created_at).slice(0, 10),
    }
  })
}

// ── Real DB: usecase breakdown ────────────────────────────────────────────────

async function getUsecaseBreakdownReal(
  filters: AnalyticsFilters
): Promise<UsecaseRow[] | null> {
  const { from, to, usecaseIds } = filters
  const { clause: ucBase, params: ucParams } = usecaseClause(usecaseIds, "base")

  const scoreIn  = fieldInClause("score",  "sc.field_key")
  const resultIn = fieldInClause("result", "r.field_key")

  const rows = await safeQuery<{
    usecase_id:        number
    total_evaluations: number
    avg_score:         number | null
    passed:            number
    total_results:     number
  }>(
    `SELECT base.usecase_id,
            COUNT(DISTINCT base.saved_report_id)                              AS total_evaluations,
            ROUND(AVG(sc.value_num), 2)                                       AS avg_score,
            COUNT(DISTINCT CASE WHEN TRIM(r.value_text) != 'Deficiente'
                                THEN r.saved_report_id END)                   AS passed,
            COUNT(DISTINCT r.saved_report_id)                                 AS total_results
     FROM (
       SELECT DISTINCT usecase_id, saved_report_id
       FROM report_field_current
       WHERE report_created_at BETWEEN ? AND ?
     ) base
     LEFT JOIN report_field_current sc
            ON sc.saved_report_id = base.saved_report_id
           AND ${scoreIn}
     LEFT JOIN report_field_current r
            ON r.saved_report_id  = base.saved_report_id
           AND ${resultIn}
     WHERE 1=1${ucBase}
     GROUP BY base.usecase_id
     ORDER BY total_evaluations DESC
     LIMIT 20`,
    [fmtDatetime(from), fmtDatetime(to), ...ucParams]
  )

  if (!rows) return null

  return rows.map((r) => {
    const passed = Number(r.passed ?? 0)
    const totalResults = Number(r.total_results ?? 0)
    return {
      usecaseId:        r.usecase_id,
      totalEvaluations: Number(r.total_evaluations ?? 0),
      avgScore:         normalizeScore(r.avg_score),
      passRate:         computePassRate(passed, totalResults),
      passed,
    }
  })
}

// ── Real DB: drilldown ────────────────────────────────────────────────────────

export async function getDrilldown(
  savedReportId: number,
  clientId?: string | null
): Promise<DrilldownResult | null> {
  if (!(await isDbAvailable())) return null

  const [fieldRows, payloadRows] = await Promise.all([
    safeQuery<{
      field_key:         string
      field_label:       string | null
      value_num:         number | null
      value_text:        string | null
      value_longtext:    string | null
      usecase_id:        number | null
      report_created_at: string
    }>(
      `SELECT field_key, field_label, value_num, value_text, value_longtext,
              usecase_id, report_created_at
       FROM report_field_current
       WHERE saved_report_id = ?
       ORDER BY id`,
      [savedReportId]
    ),
    safeQuery<{ closing_json: string; report_created_at: string }>(
      `SELECT closing_json, report_created_at
       FROM report_payload_current
       WHERE saved_report_id = ?
       LIMIT 1`,
      [savedReportId]
    ),
  ])

  if (!fieldRows || !payloadRows) return null
  if (fieldRows.length === 0 && payloadRows.length === 0) return null

  const resolvedUsecaseId = fieldRows[0]?.usecase_id ?? null
  if (clientId && resolvedUsecaseId !== null && !canClientAccessUsecase(clientId, resolvedUsecaseId)) {
    // Prevent cross-tenant drilldown leakage (Phase 1 usecase_id mapping)
    return null
  }

  let closingJson: Record<string, unknown> | null = null
  try {
    if (payloadRows[0]?.closing_json) {
      closingJson = JSON.parse(payloadRows[0].closing_json)
    }
  } catch { /* leave null on malformed JSON */ }

  const first = fieldRows[0] ?? payloadRows[0]

  return {
    savedReportId,
    usecaseId: fieldRows[0]?.usecase_id ?? null,
    date: String(first?.report_created_at ?? "").slice(0, 10),
    fields: fieldRows.map((r) => {
      const { value: normalizedValue } = normalizeField(r)
      return {
        fieldKey:       r.field_key,
        fieldLabel:     r.field_label,
        valueNum:       r.value_num  !== null ? Number(r.value_num) : null,
        valueText:      r.value_text,
        valueLongtext:  r.value_longtext,
        normalizedValue,
      }
    }),
    closingJson,
  }
}

// ── Public API — these are what API routes call ───────────────────────────────

export async function getOverviewKpis(
  filters: AnalyticsFilters
): Promise<OverviewKpis> {
  filters = withTenant(filters)
  if (await isDbAvailable()) {
    const data = await getOverviewKpisReal(filters)
    if (data) return data
  }
  return emptyOverview()
}

export async function getTrends(
  filters: AnalyticsFilters
): Promise<TrendsResult> {
  filters = withTenant(filters)
  if (await isDbAvailable()) {
    const data = await getTrendsReal(filters)
    if (data) return data
  }
  return emptyTrends()
}

export async function getEvaluationResults(
  filters: AnalyticsFilters,
  limit = 50
): Promise<EvaluationRow[]> {
  filters = withTenant(filters)
  if (await isDbAvailable()) {
    const data = await getEvaluationResultsReal(filters, limit)
    if (data) return data
  }
  return []
}

export async function getUsecaseBreakdown(
  filters: AnalyticsFilters
): Promise<UsecaseRow[]> {
  filters = withTenant(filters)
  if (await isDbAvailable()) {
    const data = await getUsecaseBreakdownReal(filters)
    if (data) return data
  }
  return []
}

// ── Route-facing aliases ──────────────────────────────────────────────────────

export async function getDashboardOverview(filters: AnalyticsFilters) {
  return getOverviewKpis(filters)
}

export async function getDashboardTrends(filters: AnalyticsFilters) {
  return getTrends(filters)
}
