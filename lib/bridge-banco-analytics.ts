/**
 * bridge-banco-analytics.ts
 *
 * Banco data adapter — queries coach_app.banco_users / saved_reports /
 * saved_reports_options DIRECTLY via mysql2 (no PHP bridge).
 *
 * Env vars (Banco-specific, fall back to DB_* if not set):
 *   BANCO_DB_HOST     | DB_HOST
 *   BANCO_DB_USER     | DB_USER
 *   BANCO_DB_PASSWORD | DB_PASSWORD
 *   BANCO_DB_NAME     | DB_NAME      (default: coach_app)
 *   BANCO_DB_PORT     | DB_PORT      (default: 3306)
 *
 * Score extraction — MySQL 5.7+ compatible SUBSTRING_INDEX chain:
 *   retro sample: "<strong>Total score:</strong> 65<br/>..."
 *   Step 1: SUBSTRING_INDEX(retro, 'Total score:</strong> ', -1) → "65<br/>..."
 *   Step 2: SUBSTRING_INDEX(..., '<', 1)                         → "65"
 *   Step 3: CAST(TRIM(...) AS UNSIGNED)                          → 65
 *
 * Pass threshold: session avg score >= 60
 *
 * ISOLATION RULES:
 *   ✅ Only touches coach_app.banco_users, saved_reports, saved_reports_options
 *   ❌ Never references customer_id (Banco uses banco_user_id hierarchy)
 *   ❌ Never imports from bridge-client.ts or data-provider.ts
 */

import mysql from 'mysql2/promise'
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

// ── Direct MySQL pool (lazy init) ─────────────────────────────────────────────

let bancoPool: mysql.Pool | null = null

function getBancoPool(): mysql.Pool {
  if (bancoPool) return bancoPool

  const host     = process.env.BANCO_DB_HOST     ?? process.env.DB_HOST
  const user     = process.env.BANCO_DB_USER     ?? process.env.DB_USER
  const password = process.env.BANCO_DB_PASSWORD ?? process.env.DB_PASSWORD ?? ''
  const database = process.env.BANCO_DB_NAME     ?? process.env.DB_NAME ?? 'coach_app'
  const port     = Number(process.env.BANCO_DB_PORT ?? process.env.DB_PORT ?? 3306)

  if (!host || !user) {
    throw new Error(
      'Banco DB not configured. Set BANCO_DB_HOST + BANCO_DB_USER ' +
      '(or DB_HOST + DB_USER as fallback).'
    )
  }

  bancoPool = mysql.createPool({
    host, user, password, database, port,
    waitForConnections: true,
    connectionLimit:    5,
    queueLimit:         0,
    timezone:           'Z',
  })

  return bancoPool
}

async function bancoQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await getBancoPool().execute(sql, params as any)
  return rows as T[]
}

/** ISO-8601 → MySQL DATETIME string (UTC) */
function isoToMysql(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
}

// ── Shared subquery (reused across all 5 adapters) ────────────────────────────

const SESSION_SCORES_SUBQUERY = `
  SELECT
    sr.id            AS session_id,
    sr.usecase_id,
    sr.banco_user_id,
    sr.date_created,
    AVG(
      CAST(
        TRIM(
          SUBSTRING_INDEX(
            SUBSTRING_INDEX(sro.retro, 'Total score:</strong> ', -1),
            '<', 1
          )
        ) AS UNSIGNED
      )
    ) AS session_avg
  FROM coach_app.saved_reports sr
  JOIN coach_app.saved_reports_options sro
    ON sro.saved_report_id = sr.id
  WHERE sr.banco_user_id > 0
    AND sr.date_created BETWEEN ? AND ?
    AND sro.retro LIKE '%Total score:</strong>%'
  GROUP BY sr.id, sr.usecase_id, sr.banco_user_id, sr.date_created
  HAVING session_avg IS NOT NULL
`

// ── 1. Overview ───────────────────────────────────────────────────────────────

export async function bancoDashboardOverview(params: {
  fromIso:     string
  toIso:       string
  prevFromIso: string
  prevToIso:   string
}): Promise<OverviewApiResponse> {
  const curFrom  = isoToMysql(params.fromIso)
  const curTo    = isoToMysql(params.toIso)
  const prevFrom = isoToMysql(params.prevFromIso)
  const prevTo   = isoToMysql(params.prevToIso)

  const periodQuery = `
    SELECT
      COUNT(*)                                                        AS totalEvaluations,
      ROUND(AVG(s.session_avg), 2)                                    AS avgScore,
      SUM(CASE WHEN s.session_avg >= 60 THEN 1 ELSE 0 END)           AS passedEvaluations,
      ROUND(
        100.0 * SUM(CASE WHEN s.session_avg >= 60 THEN 1 ELSE 0 END)
        / NULLIF(COUNT(*), 0),
        2
      )                                                               AS passRate
    FROM (${SESSION_SCORES_SUBQUERY}) s
  `

  type PeriodRow = {
    totalEvaluations:  number | string
    avgScore:          number | string | null
    passedEvaluations: number | string
    passRate:          number | string | null
  }

  const [curRows, prevRows] = await Promise.all([
    bancoQuery<PeriodRow>(periodQuery, [curFrom, curTo]),
    bancoQuery<PeriodRow>(periodQuery, [prevFrom, prevTo]),
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
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)

  type TrendRow = {
    date:      string
    avg_score: number | string | null
    passed:    number | string
    failed:    number | string
    total:     number | string
  }

  const rows = await bancoQuery<TrendRow>(
    `SELECT
       DATE(s.date_created)                                           AS date,
       ROUND(AVG(s.session_avg), 2)                                   AS avg_score,
       SUM(CASE WHEN s.session_avg >= 60 THEN 1 ELSE 0 END)          AS passed,
       SUM(CASE WHEN s.session_avg <  60 THEN 1 ELSE 0 END)          AS failed,
       COUNT(*)                                                        AS total
     FROM (${SESSION_SCORES_SUBQUERY}) s
     GROUP BY DATE(s.date_created)
     ORDER BY date ASC`,
    [from, to],
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
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)

  type BreakdownRow = {
    usecaseId:        number | string | null
    totalEvaluations: number | string
    avgScore:         number | string | null
    passRate:         number | string | null
    passed:           number | string
  }

  const rows = await bancoQuery<BreakdownRow>(
    `SELECT
       s.usecase_id                                                    AS usecaseId,
       COUNT(*)                                                        AS totalEvaluations,
       ROUND(AVG(s.session_avg), 2)                                    AS avgScore,
       ROUND(
         100.0 * SUM(CASE WHEN s.session_avg >= 60 THEN 1 ELSE 0 END)
         / NULLIF(COUNT(*), 0),
         2
       )                                                               AS passRate,
       SUM(CASE WHEN s.session_avg >= 60 THEN 1 ELSE 0 END)           AS passed
     FROM (${SESSION_SCORES_SUBQUERY}) s
     GROUP BY s.usecase_id
     ORDER BY totalEvaluations DESC`,
    [from, to],
  )

  const data: UsecaseApiRow[] = rows.map(r => ({
    usecaseId:        Number(r.usecaseId ?? 0),
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
  const from  = isoToMysql(params.fromIso)
  const to    = isoToMysql(params.toIso)
  const limit = Math.min(Math.max(1, params.limit), 20)

  type PerformerRow = {
    user_name: string
    sessions:  number | string
    avg_score: number | string | null
    pass_rate: number | string | null
  }

  const rows = await bancoQuery<PerformerRow>(
    `SELECT
       bu.name                                                         AS user_name,
       COUNT(*)                                                        AS sessions,
       ROUND(AVG(s.session_avg), 2)                                    AS avg_score,
       ROUND(
         100.0 * SUM(CASE WHEN s.session_avg >= 60 THEN 1 ELSE 0 END)
         / NULLIF(COUNT(*), 0),
         2
       )                                                               AS pass_rate
     FROM (${SESSION_SCORES_SUBQUERY}) s
     JOIN coach_app.banco_users bu ON bu.ID = s.banco_user_id
     GROUP BY s.banco_user_id, bu.name
     ORDER BY avg_score DESC, sessions DESC
     LIMIT ?`,
    [from, to, limit],
  )

  const data: BestPerformerRow[] = rows.map(r => ({
    user_email: '',
    user_name:  r.user_name ?? null,
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
  const from  = isoToMysql(params.fromIso)
  const to    = isoToMysql(params.toIso)
  const limit = Math.min(Math.max(1, params.limit), 200)

  type ResultRow = {
    savedReportId: number | string
    usecaseId:     number | string | null
    score:         number | string | null
    passed:        number | string
    date:          string
  }

  const rows = await bancoQuery<ResultRow>(
    `SELECT
       s.session_id                                                    AS savedReportId,
       s.usecase_id                                                    AS usecaseId,
       ROUND(s.session_avg, 0)                                        AS score,
       (s.session_avg >= 60)                                          AS passed,
       DATE(s.date_created)                                           AS date
     FROM (${SESSION_SCORES_SUBQUERY}) s
     ORDER BY s.date_created DESC
     LIMIT ?`,
    [from, to, limit],
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
