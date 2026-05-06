/**
 * bridge-banco-analytics.ts
 *
 * Banco data adapter — queries the real schema that exists in coach_app.sql:
 *   saved_reports   (coach_user_id, closingretro, date_created, usecase_id)
 *   coach_users     (id, customer_id, user_email, user_name)
 *
 * NO banco_users table exists — Banco users ARE coach_users identified by
 * email domain (BANCO_EMAIL_DOMAINS env var).
 *
 * Score extraction:
 *   saved_reports.closingretro contains HTML like:
 *     "<b> Score Global de la Sesion</b>: 7.5/10. La sesión..."
 *   Scores vary in scale (/10, /20, bare number).  We normalise to 0-100:
 *     score_pct = (numerator / denominator) * 100
 *     denominator = number after '/' if present, else 10 (default scale).
 *
 * Pass threshold: session_score_pct >= 60 (i.e. ≥ 6/10)
 *
 * Data access: uses query() from lib/db.ts — bridge if BRIDGE_URL is set,
 * direct mysql2 otherwise.  Same mechanism as the standard analytics pipeline.
 *
 * ISOLATION RULES:
 *   ✅ Only touches saved_reports + coach_users (filtered by email domain)
 *   ❌ Never references customer_id in queries (Banco = email-domain filter)
 *   ❌ Never imports from bridge-client.ts or data-provider.ts
 */

import { query } from '@/lib/db'
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
} from '@/lib/types'

// ── Domain filter ─────────────────────────────────────────────────────────────

/**
 * Build a SQL WHERE fragment that restricts rows to Banco email domains.
 * BANCO_EMAIL_DOMAINS = "bancoppel.com,coppel.com"
 *
 * Returns { cond, params } where params are positional ? bindings.
 * If no domains are configured, returns 1=0 (returns no rows — safe fallback).
 */
function bancoDomains(): { cond: string; params: string[] } {
  const raw     = process.env.BANCO_EMAIL_DOMAINS ?? ''
  const domains = raw.split(',').map(d => d.trim().toLowerCase()).filter(Boolean)
  if (!domains.length) return { cond: '1=0', params: [] }
  return {
    cond:   `(${domains.map(() => 'cu.user_email LIKE ?').join(' OR ')})`,
    params: domains.map(d => `%@${d}`),
  }
}

/** ISO-8601 → MySQL DATETIME string (UTC) */
function isoToMysql(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
}

// ── Score extraction expression (MySQL, reused in all 5 adapters) ─────────────
//
// closingretro sample:
//   "<b> Score Global de la Sesion</b>: 7.5/10. La sesión muestra..."
//   "<b> Score Global de la Sesion</b>: 8.5. La sesión..."
//   "<b> Score Global de la Sesion</b>: 10/20. Se otorga..."
//
// Step 1 — suffix after the label:
//   SUBSTRING_INDEX(closingretro, 'Score Global de la Sesion</b>: ', -1)
//   → "7.5/10. La sesión..."
//
// Step 2 — numerator (before '/'):
//   CAST(SUBSTRING_INDEX(suffix, '/', 1) AS DECIMAL(5,2))
//   → 7.5
//
// Step 3 — denominator (after '/', or 10 if no '/'):
//   IF(LOCATE('/', suffix) > 0,
//     GREATEST(1, CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(suffix,'/',-1),' ',1) AS DECIMAL(5,2))),
//     10)
//   → 10
//
// Step 4 — percentage:
//   ROUND((numerator / denominator) * 100, 2)
//   → 75.00

const SCORE_EXPR = `
  ROUND(
    CAST(SUBSTRING_INDEX(
      SUBSTRING_INDEX(sr.closingretro, 'Score Global de la Sesion</b>: ', -1),
      '/', 1
    ) AS DECIMAL(5,2))
    /
    IF(
      LOCATE('/', SUBSTRING_INDEX(sr.closingretro, 'Score Global de la Sesion</b>: ', -1)) > 0,
      GREATEST(1, CAST(SUBSTRING_INDEX(SUBSTRING_INDEX(
        SUBSTRING_INDEX(sr.closingretro, 'Score Global de la Sesion</b>: ', -1),
        '/', -1
      ), ' ', 1) AS DECIMAL(5,2))),
      10
    ) * 100,
    2
  )
`.trim()

/**
 * Inner subquery: one row per saved_report with computed score_pct.
 * Caller must append [domainParams..., fromStr, toStr] to their params array.
 */
function sessionSubquery(domainCond: string): string {
  return `
    SELECT
      sr.id           AS session_id,
      sr.usecase_id,
      sr.coach_user_id,
      cu.user_name,
      cu.user_email,
      sr.date_created,
      ${SCORE_EXPR}   AS score_pct
    FROM saved_reports sr
    JOIN coach_users cu ON cu.id = sr.coach_user_id
    WHERE ${domainCond}
      AND sr.date_created BETWEEN ? AND ?
      AND sr.closingretro LIKE '%Score Global de la Sesion%'
    HAVING score_pct IS NOT NULL AND score_pct > 0
  `
}

// ── 1. Overview ───────────────────────────────────────────────────────────────

export async function bancoDashboardOverview(params: {
  fromIso:     string
  toIso:       string
  prevFromIso: string
  prevToIso:   string
}): Promise<OverviewApiResponse> {
  const { cond, params: domainParams } = bancoDomains()

  const curFrom  = isoToMysql(params.fromIso)
  const curTo    = isoToMysql(params.toIso)
  const prevFrom = isoToMysql(params.prevFromIso)
  const prevTo   = isoToMysql(params.prevToIso)

  const sql = `
    SELECT
      COUNT(*)                                                     AS totalEvaluations,
      ROUND(AVG(s.score_pct), 2)                                   AS avgScore,
      SUM(CASE WHEN s.score_pct >= 60 THEN 1 ELSE 0 END)          AS passedEvaluations,
      ROUND(
        100.0 * SUM(CASE WHEN s.score_pct >= 60 THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0),
        2
      )                                                            AS passRate
    FROM (${sessionSubquery(cond)}) s
  `

  type PeriodRow = {
    totalEvaluations:  string | number
    avgScore:          string | number | null
    passedEvaluations: string | number
    passRate:          string | number | null
  }

  const [curRows, prevRows] = await Promise.all([
    query<PeriodRow>(sql, [...domainParams, curFrom,  curTo]),
    query<PeriodRow>(sql, [...domainParams, prevFrom, prevTo]),
  ])

  const cur  = curRows[0]
  const prev = prevRows[0]

  return {
    totalEvaluations:     Number(cur?.totalEvaluations  ?? 0),
    avgScore:             cur?.avgScore  != null ? Number(cur.avgScore)  : null,
    passRate:             cur?.passRate  != null ? Number(cur.passRate)  : null,
    passedEvaluations:    Number(cur?.passedEvaluations ?? 0),
    prevTotalEvaluations: Number(prev?.totalEvaluations  ?? 0),
    prevAvgScore:         prev?.avgScore != null ? Number(prev.avgScore) : null,
    prevPassRate:         prev?.passRate != null ? Number(prev.passRate) : null,
  }
}

// ── 2. Trends ─────────────────────────────────────────────────────────────────

export async function bancoDashboardTrends(params: {
  fromIso: string
  toIso:   string
}): Promise<TrendsApiResponse> {
  const { cond, params: domainParams } = bancoDomains()
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)

  type TrendRow = {
    date:       string
    avg_score:  string | number | null
    passed:     string | number
    failed:     string | number
    total:      string | number
  }

  const rows = await query<TrendRow>(
    `SELECT
       DATE(s.date_created)                                          AS date,
       ROUND(AVG(s.score_pct), 2)                                    AS avg_score,
       SUM(CASE WHEN s.score_pct >= 60 THEN 1 ELSE 0 END)           AS passed,
       SUM(CASE WHEN s.score_pct <  60 THEN 1 ELSE 0 END)           AS failed,
       COUNT(*)                                                       AS total
     FROM (${sessionSubquery(cond)}) s
     GROUP BY DATE(s.date_created)
     ORDER BY date ASC`,
    [...domainParams, from, to],
  )

  const scoreTrend:     ApiTrendPoint[] = []
  const passFailTrend:  ApiTrendPoint[] = []
  const evalCountTrend: ApiTrendPoint[] = []

  for (const r of rows) {
    const date = String(r.date).slice(0, 10)
    scoreTrend.push({ date, value: r.avg_score != null ? Number(r.avg_score) : 0 })
    passFailTrend.push({ date, value: Number(r.passed), value2: Number(r.failed) })
    evalCountTrend.push({ date, value: Number(r.total) })
  }

  return { scoreTrend, passFailTrend, evalCountTrend }
}

// ── 3. Usecase breakdown ──────────────────────────────────────────────────────

export async function bancoDashboardUsecaseBreakdown(params: {
  fromIso: string
  toIso:   string
}): Promise<UsecaseBreakdownApiResponse> {
  const { cond, params: domainParams } = bancoDomains()
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)

  type BreakdownRow = {
    usecaseId:        string | number | null
    totalEvaluations: string | number
    avgScore:         string | number | null
    passRate:         string | number | null
    passed:           string | number
  }

  const rows = await query<BreakdownRow>(
    `SELECT
       s.usecase_id                                                   AS usecaseId,
       COUNT(*)                                                       AS totalEvaluations,
       ROUND(AVG(s.score_pct), 2)                                    AS avgScore,
       ROUND(
         100.0 * SUM(CASE WHEN s.score_pct >= 60 THEN 1 ELSE 0 END)
         / NULLIF(COUNT(*), 0),
         2
       )                                                             AS passRate,
       SUM(CASE WHEN s.score_pct >= 60 THEN 1 ELSE 0 END)           AS passed
     FROM (${sessionSubquery(cond)}) s
     GROUP BY s.usecase_id
     ORDER BY totalEvaluations DESC`,
    [...domainParams, from, to],
  )

  const data: UsecaseApiRow[] = rows.map(r => ({
    usecaseId:        r.usecaseId != null ? Number(r.usecaseId) : null,
    usecase_name:     null,
    totalEvaluations: Number(r.totalEvaluations),
    avgScore:         r.avgScore != null ? Number(r.avgScore) : null,
    passRate:         r.passRate != null ? Number(r.passRate) : null,
    passed:           Number(r.passed),
  }))

  return { data }
}

// ── 4. Best performers ────────────────────────────────────────────────────────

export async function bancoDashboardBestPerformers(params: {
  fromIso: string
  toIso:   string
  limit:   number
}): Promise<BestPerformersApiResponse> {
  const { cond, params: domainParams } = bancoDomains()
  const from  = isoToMysql(params.fromIso)
  const to    = isoToMysql(params.toIso)
  const limit = Math.min(Math.max(1, params.limit), 20)

  type PerformerRow = {
    user_name:  string | null
    user_email: string
    sessions:   string | number
    avg_score:  string | number | null
    pass_rate:  string | number | null
  }

  const rows = await query<PerformerRow>(
    `SELECT
       s.user_name,
       s.user_email,
       COUNT(*)                                                       AS sessions,
       ROUND(AVG(s.score_pct), 2)                                    AS avg_score,
       ROUND(
         100.0 * SUM(CASE WHEN s.score_pct >= 60 THEN 1 ELSE 0 END)
         / NULLIF(COUNT(*), 0),
         2
       )                                                             AS pass_rate
     FROM (${sessionSubquery(cond)}) s
     GROUP BY s.coach_user_id, s.user_name, s.user_email
     ORDER BY avg_score DESC, sessions DESC
     LIMIT ?`,
    [...domainParams, from, to, limit],
  )

  const data: BestPerformerRow[] = rows.map(r => ({
    user_email: r.user_email ?? '',
    user_name:  r.user_name  ?? null,
    sessions:   Number(r.sessions),
    avg_score:  r.avg_score != null ? Number(r.avg_score) : 0,
    pass_rate:  r.pass_rate != null ? Number(r.pass_rate) : 0,
  }))

  return { data }
}

// ── 5. Individual results ─────────────────────────────────────────────────────

export async function bancoDashboardResults(params: {
  fromIso: string
  toIso:   string
  limit:   number
}): Promise<ResultsApiResponse> {
  const { cond, params: domainParams } = bancoDomains()
  const from  = isoToMysql(params.fromIso)
  const to    = isoToMysql(params.toIso)
  const limit = Math.min(Math.max(1, params.limit), 200)

  type ResultRow = {
    savedReportId: string | number
    usecaseId:     string | number | null
    score:         string | number | null
    passed:        string | number
    date:          string
  }

  const rows = await query<ResultRow>(
    `SELECT
       s.session_id                                                   AS savedReportId,
       s.usecase_id                                                   AS usecaseId,
       ROUND(s.score_pct, 0)                                         AS score,
       (s.score_pct >= 60)                                           AS passed,
       DATE(s.date_created)                                          AS date
     FROM (${sessionSubquery(cond)}) s
     ORDER BY s.date_created DESC
     LIMIT ?`,
    [...domainParams, from, to, limit],
  )

  const data: EvaluationApiRow[] = rows.map(r => {
    const passed = Number(r.passed) === 1
    return {
      savedReportId: Number(r.savedReportId),
      usecaseId:     r.usecaseId != null ? Number(r.usecaseId) : null,
      score:         r.score     != null ? Number(r.score)     : null,
      result:        passed ? 'passed' : 'failed',
      passed,
      date:          String(r.date).slice(0, 10),
    }
  })

  return { data }
}
