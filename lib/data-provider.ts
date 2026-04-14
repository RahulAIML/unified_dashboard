/**
 * data-provider.ts — server-side only data layer.
 *
 * Design principles:
 *  1. safeQuery()     – wraps every DB call; returns null on ANY error, never throws
 *  2. normalizeField()– resolves inconsistent schema columns into a single value
 *  3. DB probe cache  – health-checks DB once per 30 s; result cached in memory
 *  4. Auto-fallback   – every function silently returns mock data when DB is unavailable
 *  5. Opaque API      – callers never see "DB error" or "fallback" in the response
 *
 * To enable real DB:  set USE_REAL_DB=true in .env.local
 * The system still falls back to mock automatically if the DB is unreachable.
 */

import { query } from "./db"
import {
  getGlobalOverviewData,
  getSimulatorData,
  getCertificationData,
} from "./mock-data"
import type { DateRange } from "./types"

// ── Env switch ────────────────────────────────────────────────────────────────
// Default: false (mock only).  Set USE_REAL_DB=true in .env.local to enable.
const USE_REAL_DB = process.env.USE_REAL_DB === "true"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnalyticsFilters {
  from: Date
  to: Date
  /** Filter by usecase_id. Empty array = no filter (all usecases). */
  usecaseIds?: number[]
}

export interface OverviewKpis {
  totalEvaluations: number
  avgScore: number | null
  passRate: number | null        // 0-100
  passedEvaluations: number
  prevTotalEvaluations: number
  prevAvgScore: number | null
  prevPassRate: number | null
}

export interface TrendPoint {
  date: string                   // YYYY-MM-DD
  value: number
  value2?: number                // pass/fail stacked: value=passed, value2=failed
}

export interface TrendsResult {
  scoreTrend: TrendPoint[]
  passFailTrend: TrendPoint[]
  evalCountTrend: TrendPoint[]
}

export interface EvaluationRow {
  savedReportId: number
  usecaseId: number | null
  score: number | null
  result: string | null
  passed: boolean
  date: string                   // YYYY-MM-DD
}

export interface UsecaseRow {
  usecaseId: number
  totalEvaluations: number
  avgScore: number | null
  passRate: number | null
  passed: number
}

export interface DrilldownField {
  fieldKey: string
  fieldLabel: string | null
  valueNum: number | null
  valueText: string | null
  valueLongtext: string | null
  /** Resolved value: value_num > value_text > value_longtext > null */
  normalizedValue: number | string | null
}

export interface DrilldownResult {
  savedReportId: number
  usecaseId: number | null
  date: string
  fields: DrilldownField[]
  closingJson: Record<string, unknown> | null
}

// ── normalizeField ────────────────────────────────────────────────────────────
/**
 * Resolves the actual value from a report_field_current row.
 * Handles schema inconsistencies where the same logical value may be stored
 * in value_num, value_text, or value_longtext depending on the usecase.
 *
 *   value_num     → always preferred (numeric data is authoritative)
 *   value_text    → short text fallback
 *   value_longtext→ long-form text last resort
 */
export interface RawFieldRow {
  field_key: string
  value_num?: number | string | null
  value_text?: string | null
  value_longtext?: string | null
}

export function normalizeField(row: RawFieldRow): {
  key: string
  value: number | string | null
} {
  let value: number | string | null = null

  if (row.value_num !== undefined && row.value_num !== null) {
    const n = Number(row.value_num)
    value = Number.isFinite(n) ? n : null
  }

  if (value === null && row.value_text !== undefined && row.value_text !== null && row.value_text.trim() !== "") {
    value = row.value_text.trim()
  }

  if (value === null && row.value_longtext !== undefined && row.value_longtext !== null && row.value_longtext.trim() !== "") {
    value = row.value_longtext.trim()
  }

  return { key: row.field_key, value }
}

// ── safeQuery ─────────────────────────────────────────────────────────────────
/**
 * Wraps every DB call.
 * Returns the row array on success, or null on ANY error (network, auth, SQL, etc).
 * Never throws. Never exposes DB errors to callers.
 */
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
      console.warn("⚠️  Using mock data — DB unreachable:", code)
    } else if (msg.includes("ER_ACCESS_DENIED")) {
      console.warn("⚠️  Using mock data — DB access denied")
    } else {
      console.warn("⚠️  Using mock data due to DB issue:", msg)
    }

    return null
  }
}

// ── DB availability probe ─────────────────────────────────────────────────────
// Results are cached for 30 s so we don't probe on every single request.
let _dbAvailable: boolean | null = null
let _dbProbeAt   = 0
const PROBE_TTL  = 30_000   // ms

async function isDbAvailable(): Promise<boolean> {
  if (!USE_REAL_DB) return false

  const now = Date.now()
  if (_dbAvailable !== null && now - _dbProbeAt < PROBE_TTL) return _dbAvailable

  const rows = await safeQuery<{ ok: number }>("SELECT 1 AS ok")
  _dbAvailable = rows !== null
  _dbProbeAt   = now

  if (_dbAvailable) {
    console.info("✅ DB connection healthy")
  }

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
  if (!usecaseIds || usecaseIds.length === 0) return { clause: "", params: [] }
  const placeholders = usecaseIds.map(() => "?").join(", ")
  return {
    clause: ` AND ${alias}.usecase_id IN (${placeholders})`,
    params: usecaseIds,
  }
}

function toRange(filters: AnalyticsFilters): DateRange {
  return { from: filters.from, to: filters.to }
}

function toNumber(v: number | string | null | undefined): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  return 0
}

function toNullableNumber(v: number | string | null | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null }
  return null
}

// ── Mock implementations ──────────────────────────────────────────────────────
function getOverviewKpisMock(filters: AnalyticsFilters): OverviewKpis {
  const range   = toRange(filters)
  const mock    = getGlobalOverviewData(range)
  const prior   = priorPeriod(filters.from, filters.to)
  const prevMock = getGlobalOverviewData({ from: prior.from, to: prior.to })
  return {
    totalEvaluations:     toNumber(mock.kpis.totalSessions.value),
    avgScore:             toNullableNumber(mock.kpis.avgScore.value),
    passRate:             toNullableNumber(mock.kpis.passRate.value),
    passedEvaluations:    toNumber(mock.kpis.certifiedUsers.value),
    prevTotalEvaluations: toNumber(prevMock.kpis.totalSessions.value),
    prevAvgScore:         toNullableNumber(prevMock.kpis.avgScore.value),
    prevPassRate:         toNullableNumber(prevMock.kpis.passRate.value),
  }
}

function getTrendsMock(filters: AnalyticsFilters): TrendsResult {
  const range   = toRange(filters)
  const overview  = getGlobalOverviewData(range)
  const simulator = getSimulatorData(range)
  const cert      = getCertificationData(range)
  return {
    scoreTrend:    simulator.scoreTrend    as TrendPoint[],
    passFailTrend: cert.passFail           as TrendPoint[],
    evalCountTrend: overview.activityTrend as TrendPoint[],
  }
}

function getUsecaseBreakdownMock(filters: AnalyticsFilters): UsecaseRow[] {
  const breakdown = getGlobalOverviewData(toRange(filters)).moduleBreakdown
  return breakdown.map((row, i) => {
    const total  = toNumber(row.sessions)
    const passed = toNumber(row.passed)
    return {
      usecaseId:        i + 1,
      totalEvaluations: total,
      avgScore:         null,
      passRate:         total > 0 ? Math.round((passed / total) * 100) : null,
      passed,
    }
  })
}

function getEvaluationResultsMock(
  filters: AnalyticsFilters,
  limit = 50
): EvaluationRow[] {
  const rows = getCertificationData(toRange(filters)).resultsTable
  return rows.slice(0, limit).map((r, i) => ({
    savedReportId: 1000 + i,
    usecaseId:     (i % 8) + 1,
    score:         r.score,
    result:        r.segment,
    passed:        r.passed,
    date:          r.date,
  }))
}

// ── Real DB implementations ───────────────────────────────────────────────────

async function getOverviewKpisReal(
  filters: AnalyticsFilters
): Promise<OverviewKpis | null> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)
  const prior = priorPeriod(from, to)

  async function fetchPeriod(pFrom: Date, pTo: Date) {
    const dateParams = [fmtDatetime(pFrom), fmtDatetime(pTo)]

    const scoreRows = await safeQuery<{ total: number; avg_score: number | null }>(
      `SELECT COUNT(DISTINCT saved_report_id) AS total,
              ROUND(AVG(value_num), 1)        AS avg_score
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_score'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
      [...dateParams, ...ucParams]
    )
    if (!scoreRows) return null

    const pfRows = await safeQuery<{ passed: number; total_res: number }>(
      `SELECT COUNT(CASE WHEN value_text != 'Deficiente' THEN 1 END) AS passed,
              COUNT(*)                                                 AS total_res
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_result'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
      [...dateParams, ...ucParams]
    )
    if (!pfRows) return null

    const total    = scoreRows[0]?.total    ?? 0
    const avgScore = scoreRows[0]?.avg_score ?? null
    const passed   = pfRows[0]?.passed      ?? 0
    const totalRes = pfRows[0]?.total_res   ?? 0
    const passRate = totalRes > 0
      ? Math.round((passed / totalRes) * 100 * 10) / 10
      : null

    return { total, avgScore, passRate, passed }
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

async function getTrendsReal(
  filters: AnalyticsFilters
): Promise<TrendsResult | null> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)
  const dateParams = [fmtDatetime(from), fmtDatetime(to)]

  const [scoreRows, pfRows, countRows] = await Promise.all([
    safeQuery<{ date: string; value: number }>(
      `SELECT DATE(report_created_at)       AS date,
              ROUND(AVG(value_num), 1)      AS value
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_score'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dateParams, ...ucParams]
    ),
    safeQuery<{ date: string; value: number; value2: number }>(
      `SELECT DATE(report_created_at)                                        AS date,
              COUNT(CASE WHEN value_text != 'Deficiente' THEN 1 END)         AS value,
              COUNT(CASE WHEN value_text  = 'Deficiente' THEN 1 END)         AS value2
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_result'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dateParams, ...ucParams]
    ),
    safeQuery<{ date: string; value: number }>(
      `SELECT DATE(report_created_at)           AS date,
              COUNT(DISTINCT saved_report_id)   AS value
       FROM report_field_current rfc
       WHERE rfc.field_key = 'overall_score'
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY DATE(report_created_at)
       ORDER BY date`,
      [...dateParams, ...ucParams]
    ),
  ])

  if (!scoreRows || !pfRows || !countRows) return null

  return {
    scoreTrend:     scoreRows,
    passFailTrend:  pfRows,
    evalCountTrend: countRows,
  }
}

async function getEvaluationResultsReal(
  filters: AnalyticsFilters,
  limit = 50
): Promise<EvaluationRow[] | null> {
  const { from, to, usecaseIds } = filters
  const { clause: ucS, params: ucSParams } = usecaseClause(usecaseIds, "s")

  const rows = await safeQuery<{
    saved_report_id: number
    usecase_id: number | null
    score: number | null
    result: string | null
    report_created_at: string
  }>(
    `SELECT s.saved_report_id,
            s.usecase_id,
            s.value_num               AS score,
            r.value_text              AS result,
            DATE(s.report_created_at) AS report_created_at
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

  if (!rows) return null

  return rows.map((r) => ({
    savedReportId: r.saved_report_id,
    usecaseId:     r.usecase_id,
    score:         r.score !== null ? Math.round(Number(r.score)) : null,
    result:        r.result,
    passed:        r.result !== null && r.result !== "Deficiente",
    date:          String(r.report_created_at).slice(0, 10),
  }))
}

async function getUsecaseBreakdownReal(
  filters: AnalyticsFilters
): Promise<UsecaseRow[] | null> {
  const { from, to, usecaseIds } = filters
  const { clause: uc, params: ucParams } = usecaseClause(usecaseIds)

  const rows = await safeQuery<{
    usecase_id: number
    total_evaluations: number
    avg_score: number | null
    passed: number
    total_results: number
  }>(
    `SELECT s.usecase_id,
            COUNT(DISTINCT s.saved_report_id)                           AS total_evaluations,
            ROUND(AVG(s.value_num), 1)                                  AS avg_score,
            COUNT(DISTINCT CASE WHEN r.value_text != 'Deficiente'
                                THEN r.saved_report_id END)             AS passed,
            COUNT(DISTINCT r.saved_report_id)                           AS total_results
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

  if (!rows) return null

  return rows.map((r) => ({
    usecaseId:        r.usecase_id,
    totalEvaluations: r.total_evaluations,
    avgScore:         r.avg_score !== null ? Number(r.avg_score) : null,
    passRate:
      r.total_results > 0
        ? Math.round((r.passed / r.total_results) * 100)
        : null,
    passed: r.passed,
  }))
}

// ── Public API — these are what routes call ───────────────────────────────────

export async function getOverviewKpis(
  filters: AnalyticsFilters
): Promise<OverviewKpis> {
  if (await isDbAvailable()) {
    const data = await getOverviewKpisReal(filters)
    if (data) return data
  }
  return getOverviewKpisMock(filters)
}

export async function getTrends(
  filters: AnalyticsFilters
): Promise<TrendsResult> {
  if (await isDbAvailable()) {
    const data = await getTrendsReal(filters)
    if (data) return data
  }
  return getTrendsMock(filters)
}

export async function getEvaluationResults(
  filters: AnalyticsFilters,
  limit = 50
): Promise<EvaluationRow[]> {
  if (await isDbAvailable()) {
    const data = await getEvaluationResultsReal(filters, limit)
    if (data) return data
  }
  return getEvaluationResultsMock(filters, limit)
}

export async function getUsecaseBreakdown(
  filters: AnalyticsFilters
): Promise<UsecaseRow[]> {
  if (await isDbAvailable()) {
    const data = await getUsecaseBreakdownReal(filters)
    if (data) return data
  }
  return getUsecaseBreakdownMock(filters)
}

export async function getDrilldown(
  savedReportId: number
): Promise<DrilldownResult | null> {
  if (!(await isDbAvailable())) return null

  const [fieldRows, payloadRows] = await Promise.all([
    safeQuery<{
      field_key: string
      field_label: string | null
      value_num: number | null
      value_text: string | null
      value_longtext: string | null
      usecase_id: number | null
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
        fieldKey:        r.field_key,
        fieldLabel:      r.field_label,
        valueNum:        r.value_num   !== null ? Number(r.value_num)  : null,
        valueText:       r.value_text,
        valueLongtext:   r.value_longtext,
        normalizedValue,
      }
    }),
    closingJson,
  }
}

// ── Route-facing aliases (used by app/api/dashboard/*) ───────────────────────

export async function getDashboardOverview(filters: AnalyticsFilters) {
  return getOverviewKpis(filters)
}

export async function getDashboardTrends(filters: AnalyticsFilters) {
  return getTrends(filters)
}
