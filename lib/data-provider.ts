/**
 * data-provider.ts — server-side analytics data layer (bridge-backed, multi-tenant safe)
 *
 * FINAL decisions implemented:
 * - No raw SQL from Next.js to the bridge
 * - Bridge exposes safe action endpoints only
 * - Tenant isolation enforced by customer_id (from JWT) in every bridge call
 */

import { computePassRate, normalizeScore, safeNumber, safeString } from './kpi-builder'
import { bridgeDrilldown, bridgeOverviewKpis, bridgeResults, bridgeTrends, bridgeUsecaseBreakdown } from './bridge-client'

export interface AnalyticsFilters {
  from: Date
  to: Date
  usecaseIds?: number[]
  customerId: number
}

export interface OverviewKpis {
  totalEvaluations: number
  avgScore: number | null
  passRate: number | null
  passedEvaluations: number
  prevTotalEvaluations: number
  prevAvgScore: number | null
  prevPassRate: number | null
}

export interface TrendPoint {
  date: string
  value: number
  value2?: number
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
  date: string
}

export interface UsecaseRow {
  usecaseId:        number
  usecase_name:     string | null   // display name from coach_app.usecases
  totalEvaluations: number
  avgScore:         number | null
  passRate:         number | null
  passed:           number
}

export interface DrilldownField {
  fieldKey: string
  fieldLabel: string | null
  valueNum: number | null
  valueText: string | null
  valueLongtext: string | null
  normalizedValue: number | string | null
}

export interface DrilldownResult {
  savedReportId: number
  usecaseId: number | null
  date: string
  fields: DrilldownField[]
  closingJson: Record<string, unknown> | null
}

export interface RawFieldRow {
  field_key: string
  value_num?: number | string | null
  value_text?: string | null
  value_longtext?: string | null
}

export function normalizeField(row: RawFieldRow): { value: number | string | null } {
  const n = safeNumber(row.value_num)
  if (n !== null) return { value: n }
  const t = safeString(row.value_text)
  if (t !== null) return { value: t }
  const l = safeString(row.value_longtext)
  if (l !== null) return { value: l }
  return { value: null }
}

function toIso(d: Date) {
  return d.toISOString()
}

function priorPeriod(from: Date, to: Date) {
  const spanMs = Math.max(0, to.getTime() - from.getTime())
  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = new Date(prevTo.getTime() - spanMs)
  return { from: prevFrom, to: prevTo }
}

export async function getDashboardOverview(filters: AnalyticsFilters): Promise<OverviewKpis> {
  const prior = priorPeriod(filters.from, filters.to)

  const raw = await bridgeOverviewKpis({
    customerId: filters.customerId,
    fromIso: toIso(filters.from),
    toIso: toIso(filters.to),
    usecaseIds: filters.usecaseIds,
  }) as {
    current: { total_sessions: number; avg_score: number | null; passed: number; total_results: number }
    prev: { total_sessions: number; avg_score: number | null; passed: number; total_results: number }
  }

  // If the bridge doesn't implement prior internally, fall back to computing it here
  if (!raw?.prev) {
    const rawPrev = await bridgeOverviewKpis({
      customerId: filters.customerId,
      fromIso: toIso(prior.from),
      toIso: toIso(prior.to),
      usecaseIds: filters.usecaseIds,
    }) as {
      current: { total_sessions: number; avg_score: number | null; passed: number; total_results: number }
    }
    raw.prev = rawPrev.current
  }

  const curPassRate = computePassRate(Number(raw.current.passed ?? 0), Number(raw.current.total_results ?? 0))
  const prevPassRate = computePassRate(Number(raw.prev.passed ?? 0), Number(raw.prev.total_results ?? 0))

  return {
    totalEvaluations: Number(raw.current.total_sessions ?? 0),
    avgScore: normalizeScore(raw.current.avg_score),
    passRate: curPassRate,
    passedEvaluations: Number(raw.current.passed ?? 0),
    prevTotalEvaluations: Number(raw.prev.total_sessions ?? 0),
    prevAvgScore: normalizeScore(raw.prev.avg_score),
    prevPassRate,
  }
}

export async function getDashboardTrends(filters: AnalyticsFilters): Promise<TrendsResult> {
  const raw = await bridgeTrends({
    customerId: filters.customerId,
    fromIso: toIso(filters.from),
    toIso: toIso(filters.to),
    usecaseIds: filters.usecaseIds,
  }) as {
    score_trend: { date: string; avg_score: number }[]
    pass_fail: { date: string; passed: number; failed: number }[]
    eval_count: { date: string; sessions: number }[]
  }

  return {
    scoreTrend: (raw.score_trend ?? []).map((r) => ({
      date: r.date,
      value: normalizeScore(r.avg_score) ?? 0,
    })),
    passFailTrend: (raw.pass_fail ?? []).map((r) => ({ date: r.date, value: Number(r.passed ?? 0), value2: Number(r.failed ?? 0) })),
    evalCountTrend: (raw.eval_count ?? []).map((r) => ({ date: r.date, value: Number(r.sessions ?? 0) })),
  }
}

export async function getEvaluationResults(filters: AnalyticsFilters, limit = 50): Promise<EvaluationRow[]> {
  const raw = await bridgeResults({
    customerId: filters.customerId,
    fromIso: toIso(filters.from),
    toIso: toIso(filters.to),
    usecaseIds: filters.usecaseIds,
    limit,
  }) as {
    saved_report_id: number
    usecase_id: number | null
    score: number | null
    passed_flag: number | null   // 0/1 from coach_app.saved_reports
    report_created_at: string
  }[]

  return (raw ?? []).map((r) => {
    const normScore = normalizeScore(r.score)
    return {
      savedReportId: Number(r.saved_report_id),
      usecaseId: r.usecase_id !== null ? Number(r.usecase_id) : null,
      score: normScore !== null ? Math.round(normScore) : null,
      result: r.passed_flag === 1 ? 'pass' : r.passed_flag === 0 ? 'fail' : null,
      passed: Number(r.passed_flag) === 1,
      date: String(r.report_created_at).slice(0, 10),
    }
  })
}

export async function getUsecaseBreakdown(filters: AnalyticsFilters): Promise<UsecaseRow[]> {
  const raw = await bridgeUsecaseBreakdown({
    customerId: filters.customerId,
    fromIso: toIso(filters.from),
    toIso: toIso(filters.to),
    usecaseIds: filters.usecaseIds,
  }) as {
    usecase_id: number
    total_evaluations: number
    avg_score: number | null
    passed: number
    total_results: number
  }[]

  return (raw ?? []).map((r) => {
    const row = r as typeof r & { usecase_name?: string | null }
    const passed      = Number(r.passed ?? 0)
    const totalResults = Number(r.total_results ?? 0)
    return {
      usecaseId:        Number(r.usecase_id),
      usecase_name:     row.usecase_name ?? null,
      totalEvaluations: Number(r.total_evaluations ?? 0),
      avgScore:         normalizeScore(r.avg_score),
      passRate:         computePassRate(passed, totalResults),
      passed,
    }
  })
}

export async function getDrilldown(savedReportId: number, customerId: number): Promise<DrilldownResult | null> {
  const raw = await bridgeDrilldown({ customerId, savedReportId }) as {
    saved_report_id: number
    usecase_id: number | null
    report_created_at: string
    fields: {
      field_key: string
      field_label: string | null
      value_num: number | null
      value_text: string | null
      value_longtext: string | null
    }[]
    closing_json: string | null
  }

  if (!raw) return null

  let closingJson: Record<string, unknown> | null = null
  try {
    if (raw.closing_json) closingJson = JSON.parse(raw.closing_json)
  } catch {
    closingJson = null
  }

  return {
    savedReportId: Number(raw.saved_report_id),
    usecaseId: raw.usecase_id !== null ? Number(raw.usecase_id) : null,
    date: String(raw.report_created_at).slice(0, 10),
    fields: (raw.fields ?? []).map((r) => {
      const { value: normalizedValue } = normalizeField(r)
      return {
        fieldKey: r.field_key,
        fieldLabel: r.field_label,
        valueNum: r.value_num !== null ? Number(r.value_num) : null,
        valueText: r.value_text,
        valueLongtext: r.value_longtext,
        normalizedValue,
      }
    }),
    closingJson,
  }
}

