/**
 * bridge-pharma-analytics.ts
 *
 * Data adapter for pharma-sim tenants (Sanfer, Apotex, …) served by
 * rolplay-shared-bridge on serv.aux-rolplay.com — a completely separate
 * infrastructure from the standard coach_app/rolplay_pro_analytics pipeline
 * and from Banco. See lib/pharma-tenant.ts for tenant resolution.
 *
 * Each tenant's underlying bridge has a DIFFERENT action set and response
 * shape (Apotex has purpose-built kpi.* aggregate actions; Sanfer only
 * exposes raw per-session rows via cert.sessions), so this file branches
 * per tenant internally, then maps everything into the SAME shared types
 * (OverviewApiResponse, TrendsApiResponse, …) the standard pipeline and the
 * Banco adapter already produce — the dashboard UI needs zero changes.
 *
 * ISOLATION RULES (mirrors bridge-banco-analytics.ts):
 *   ✅ Only talks to the pharma bridge over HTTPS — never touches MySQL
 *      directly, never imports from bridge-client.ts or data-provider.ts
 *   ❌ Never references customer_id — pharma tenants are resolved by email
 *      domain only (see pharma-tenant.ts)
 */

import type {
  OverviewApiResponse,
  TrendsApiResponse,
  ApiTrendPoint,
  UsecaseBreakdownApiResponse,
  UsecaseApiRow,
  BestPerformersApiResponse,
  BestPerformerRow,
  ResultsApiResponse,
  EvaluationApiRow,
} from './types'
import type { PharmaTenant } from './pharma-tenant'

const PASS_THRESHOLD = 70 // matches both tenants' own pass/fail convention

// ── HTTP client ────────────────────────────────────────────────────────────────

function bridgeBaseUrl(): string {
  const base = process.env.PHARMA_BRIDGE_BASE_URL
  if (!base) throw new Error('PHARMA_BRIDGE_BASE_URL is not configured')
  return base.replace(/\/+$/, '')
}

async function bridgeCall<T = Record<string, unknown>>(
  tenant: PharmaTenant,
  action: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const url = `${bridgeBaseUrl()}/${tenant}/bridge/`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || json.ok === false) {
    throw new Error(`pharma bridge [${tenant}/${action}] failed: ${json?.error ?? res.status}`)
  }
  return json as T
}

/** ISO-8601 → 'YYYY-MM-DD' (both bridges' date_filter expect plain dates) */
function isoToDate(iso: string): string {
  return iso.slice(0, 10)
}

// ── Sanfer: raw-row fetch + in-adapter aggregation ─────────────────────────────

interface SanferSessionRow {
  id: number
  usecase_id: number
  usecase_name: string
  email: string
  name: string
  date: string
  score: number
}

async function fetchSanferSessions(fromIso: string, toIso: string): Promise<SanferSessionRow[]> {
  const resp = await bridgeCall<{ data: SanferSessionRow[] }>('sanfer', 'cert.sessions', {
    date_from: isoToDate(fromIso),
    date_to:   isoToDate(toIso),
    limit:     20_000,
    refresh:   1,
  })
  return resp.data ?? []
}

// ── Apotex: purpose-built kpi.* actions ────────────────────────────────────────

// NOTE: fields commented "PDO string" come back as numeric strings, not
// numbers — MySQL SUM(expr) is returned as a DECIMAL string by the mysqlnd
// driver unless explicitly CAST. Always Number() these before use.
interface ApotexOverview {
  overview: {
    total_sessions: number
    avg_score: number | null
    pass_rate_pct: number
    sessions_pass: number | string // PDO string
  }
}

interface ApotexTrendRow {
  period: string
  sessions: number
  avg_score: number | null
  sessions_pass: number | string // PDO string
}

interface ApotexActivityRow {
  activity_id: number
  activity_name: string | null
  sessions: number
  avg_score: number | null
  pass_rate_pct: number
  sessions_pass: number | string // PDO string
}

interface ApotexLeaderRow {
  name: string | null
  email: string
  sessions: number
  avg_score: number | null
  pass_rate_pct: number
}

interface ApotexSessionRow {
  id: number
  fecha: string
  usecase_id: number | null
  activity_id: number
  score: number
}

// ── 1. Overview ───────────────────────────────────────────────────────────────

export async function pharmaDashboardOverview(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; prevFromIso: string; prevToIso: string },
): Promise<OverviewApiResponse> {
  if (tenant === 'apotex') {
    const [cur, prev] = await Promise.all([
      bridgeCall<ApotexOverview>('apotex', 'kpi.overview', {
        date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso),
      }),
      bridgeCall<ApotexOverview>('apotex', 'kpi.overview', {
        date_from: isoToDate(params.prevFromIso), date_to: isoToDate(params.prevToIso),
      }),
    ])
    // Apotex's SUM(expr >= n) aggregates (sessions_pass) come back from PDO as
    // numeric strings, not numbers — Number() everything defensively so the
    // response actually matches its declared OverviewApiResponse types.
    return {
      totalEvaluations:     Number(cur.overview.total_sessions),
      avgScore:             cur.overview.avg_score != null ? Number(cur.overview.avg_score) : null,
      passRate:             cur.overview.pass_rate_pct != null ? Number(cur.overview.pass_rate_pct) : null,
      passedEvaluations:    Number(cur.overview.sessions_pass),
      prevTotalEvaluations: Number(prev.overview.total_sessions),
      prevAvgScore:         prev.overview.avg_score != null ? Number(prev.overview.avg_score) : null,
      prevPassRate:         prev.overview.pass_rate_pct != null ? Number(prev.overview.pass_rate_pct) : null,
    }
  }

  // Sanfer
  const [curRows, prevRows] = await Promise.all([
    fetchSanferSessions(params.fromIso, params.toIso),
    fetchSanferSessions(params.prevFromIso, params.prevToIso),
  ])
  const agg = (rows: SanferSessionRow[]) => {
    const total  = rows.length
    const passed = rows.filter(r => r.score >= PASS_THRESHOLD).length
    const avg    = total ? rows.reduce((s, r) => s + r.score, 0) / total : null
    return {
      total,
      avgScore: avg != null ? Math.round(avg * 100) / 100 : null,
      passRate: total ? Math.round((passed / total) * 10000) / 100 : null,
      passed,
    }
  }
  const cur  = agg(curRows)
  const prev = agg(prevRows)
  return {
    totalEvaluations:     cur.total,
    avgScore:             cur.avgScore,
    passRate:             cur.passRate,
    passedEvaluations:    cur.passed,
    prevTotalEvaluations: prev.total,
    prevAvgScore:         prev.avgScore,
    prevPassRate:         prev.passRate,
  }
}

// ── 2. Trends ─────────────────────────────────────────────────────────────────

export async function pharmaDashboardTrends(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string },
): Promise<TrendsApiResponse> {
  if (tenant === 'apotex') {
    const resp = await bridgeCall<{ trend: ApotexTrendRow[] }>('apotex', 'kpi.score_trend', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso), granularity: 'day',
    })
    const scoreTrend: ApiTrendPoint[] = []
    const passFailTrend: ApiTrendPoint[] = []
    const evalCountTrend: ApiTrendPoint[] = []
    for (const r of resp.trend ?? []) {
      const sessions     = Number(r.sessions)
      const sessionsPass = Number(r.sessions_pass)
      scoreTrend.push({ date: r.period, value: r.avg_score != null ? Number(r.avg_score) : 0 })
      passFailTrend.push({ date: r.period, value: sessionsPass, value2: sessions - sessionsPass })
      evalCountTrend.push({ date: r.period, value: sessions })
    }
    return { scoreTrend, passFailTrend, evalCountTrend }
  }

  // Sanfer — aggregate raw rows by day
  const rows = await fetchSanferSessions(params.fromIso, params.toIso)
  const byDay = new Map<string, { total: number; passed: number; scoreSum: number }>()
  for (const r of rows) {
    const day = r.date.slice(0, 10)
    const bucket = byDay.get(day) ?? { total: 0, passed: 0, scoreSum: 0 }
    bucket.total++
    bucket.scoreSum += r.score
    if (r.score >= PASS_THRESHOLD) bucket.passed++
    byDay.set(day, bucket)
  }
  const days = [...byDay.keys()].sort()
  const scoreTrend: ApiTrendPoint[] = []
  const passFailTrend: ApiTrendPoint[] = []
  const evalCountTrend: ApiTrendPoint[] = []
  for (const day of days) {
    const b = byDay.get(day)!
    scoreTrend.push({ date: day, value: Math.round((b.scoreSum / b.total) * 100) / 100 })
    passFailTrend.push({ date: day, value: b.passed, value2: b.total - b.passed })
    evalCountTrend.push({ date: day, value: b.total })
  }
  return { scoreTrend, passFailTrend, evalCountTrend }
}

// ── 3. Usecase breakdown ──────────────────────────────────────────────────────

export async function pharmaDashboardUsecaseBreakdown(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string },
): Promise<UsecaseBreakdownApiResponse> {
  if (tenant === 'apotex') {
    const resp = await bridgeCall<{ activities: ApotexActivityRow[] }>('apotex', 'kpi.activity_summary', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso),
    })
    const data: UsecaseApiRow[] = (resp.activities ?? [])
      .filter(a => Number(a.sessions) > 0)
      .map(a => ({
        usecaseId:        a.activity_id,
        usecase_name:     a.activity_name,
        totalEvaluations: Number(a.sessions),
        avgScore:         a.avg_score != null ? Number(a.avg_score) : null,
        passRate:         a.pass_rate_pct != null ? Number(a.pass_rate_pct) : null,
        passed:           Number(a.sessions_pass),
      }))
    return { data }
  }

  // Sanfer — aggregate raw rows by usecase
  const rows = await fetchSanferSessions(params.fromIso, params.toIso)
  const byUc = new Map<number, { name: string; total: number; passed: number; scoreSum: number }>()
  for (const r of rows) {
    const bucket = byUc.get(r.usecase_id) ?? { name: r.usecase_name, total: 0, passed: 0, scoreSum: 0 }
    bucket.total++
    bucket.scoreSum += r.score
    if (r.score >= PASS_THRESHOLD) bucket.passed++
    byUc.set(r.usecase_id, bucket)
  }
  const data: UsecaseApiRow[] = [...byUc.entries()]
    .map(([usecaseId, b]) => ({
      usecaseId,
      usecase_name:     b.name || null,
      totalEvaluations: b.total,
      avgScore:         Math.round((b.scoreSum / b.total) * 100) / 100,
      passRate:         Math.round((b.passed / b.total) * 10000) / 100,
      passed:           b.passed,
    }))
    .sort((a, b) => b.totalEvaluations - a.totalEvaluations)
  return { data }
}

// ── 4. Best performers ────────────────────────────────────────────────────────

export async function pharmaDashboardBestPerformers(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; limit: number },
): Promise<BestPerformersApiResponse> {
  const limit = Math.min(Math.max(1, params.limit), 20)

  if (tenant === 'apotex') {
    const resp = await bridgeCall<{ leaderboard: ApotexLeaderRow[] }>('apotex', 'kpi.leaderboard', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso), limit,
    })
    const data: BestPerformerRow[] = (resp.leaderboard ?? []).map(r => ({
      user_email: r.email,
      user_name:  r.name,
      sessions:   Number(r.sessions),
      avg_score:  r.avg_score != null ? Number(r.avg_score) : 0,
      pass_rate:  Number(r.pass_rate_pct),
    }))
    return { data }
  }

  // Sanfer — aggregate raw rows by user
  const rows = await fetchSanferSessions(params.fromIso, params.toIso)
  const byUser = new Map<string, { name: string; total: number; passed: number; scoreSum: number }>()
  for (const r of rows) {
    if (!r.email) continue
    const bucket = byUser.get(r.email) ?? { name: r.name, total: 0, passed: 0, scoreSum: 0 }
    bucket.total++
    bucket.scoreSum += r.score
    if (r.score >= PASS_THRESHOLD) bucket.passed++
    if (r.name) bucket.name = r.name
    byUser.set(r.email, bucket)
  }
  const data: BestPerformerRow[] = [...byUser.entries()]
    .map(([email, b]) => ({
      user_email: email,
      user_name:  b.name || null,
      sessions:   b.total,
      avg_score:  Math.round((b.scoreSum / b.total) * 100) / 100,
      pass_rate:  Math.round((b.passed / b.total) * 10000) / 100,
    }))
    .sort((a, b) => b.avg_score - a.avg_score || b.sessions - a.sessions)
    .slice(0, limit)
  return { data }
}

// ── 5. Individual results ─────────────────────────────────────────────────────

export async function pharmaDashboardResults(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; limit: number },
): Promise<ResultsApiResponse> {
  const limit = Math.min(Math.max(1, params.limit), 200)

  if (tenant === 'apotex') {
    const resp = await bridgeCall<{ sessions: ApotexSessionRow[] }>('apotex', 'kpi.sessions', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso), limit,
    })
    const data: EvaluationApiRow[] = (resp.sessions ?? []).map(r => {
      const score  = Number(r.score)
      const passed = score >= PASS_THRESHOLD
      return {
        savedReportId: Number(r.id),
        usecaseId:     Number(r.usecase_id ?? r.activity_id),
        score,
        result:        passed ? 'passed' : 'failed',
        passed,
        date:          r.fecha.slice(0, 10),
      }
    })
    return { data }
  }

  // Sanfer
  const rows = await fetchSanferSessions(params.fromIso, params.toIso)
  const data: EvaluationApiRow[] = rows
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map(r => {
      const passed = r.score >= PASS_THRESHOLD
      return {
        savedReportId: r.id,
        usecaseId:     r.usecase_id,
        score:         r.score,
        result:        passed ? 'passed' : 'failed',
        passed,
        date:          r.date.slice(0, 10),
      }
    })
  return { data }
}
