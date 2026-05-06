/**
 * bridge-banco-analytics.ts
 *
 * Banco data adapter — queries coach_app.banco_users / saved_reports /
 * saved_reports_options and returns the SAME shapes as the standard analytics
 * pipeline (OverviewApiResponse, TrendsApiResponse, etc.).
 *
 * This lets all 5 dashboard API routes stay shape-agnostic: they call the
 * right adapter based on org type and return the same JSON to the client.
 *
 * Score extraction:
 *   saved_reports_options.retro contains HTML like:
 *     "<strong>Total score:</strong> 65<br/>..."
 *   Extracted with MySQL: REGEXP_SUBSTR(retro, 'Total score:</strong> ([0-9]+)', 1, 1, 'c', 1)
 *
 * Pass threshold: session avg score >= 60
 *
 * ISOLATION RULES:
 *   ✅ Only touches coach_app.banco_users, saved_reports, saved_reports_options
 *   ❌ Never references customer_id (Banco uses banco_user_id hierarchy)
 *   ❌ Never imports from bridge-client.ts or data-provider.ts
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
} from '@/lib/types'

// ── Bridge config ─────────────────────────────────────────────────────────────

function requireBridgeConfig() {
  const url    = process.env.BRIDGE_URL
  const secret = process.env.BRIDGE_SECRET
  if (!url)    throw new Error('BRIDGE_URL is not set')
  if (!secret) throw new Error('BRIDGE_SECRET is not set')
  return { url, secret }
}

async function bancoPost<T>(
  sql:    string,
  params: (string | number | null)[] = [],
): Promise<T[]> {
  const { url, secret } = requireBridgeConfig()
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': secret },
    body:    JSON.stringify({ sql, params }),
    cache:   'no-store',
    signal:  AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Banco bridge HTTP ${res.status}`)
  const json = (await res.json()) as { success: boolean; data: T[]; error: string | null }
  if (!json.success) throw new Error(json.error ?? 'Banco bridge error')
  return Array.isArray(json.data) ? json.data : []
}

/** ISO-8601 → MySQL DATETIME string (UTC) */
function isoToMysql(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
}

// ── Shared subquery (reused across all 5 adapters) ────────────────────────────
//
// Computes per-session avg score from retro HTML, filtered to banco sessions
// in a date range.  Callers embed this as an inner query or CTE.

const SESSION_SCORES_SUBQUERY = `
  SELECT
    sr.id            AS session_id,
    sr.usecase_id,
    sr.banco_user_id,
    sr.date_created,
    AVG(
      CAST(
        REGEXP_SUBSTR(sro.retro, 'Total score:</strong> ([0-9]+)', 1, 1, 'c', 1)
        AS UNSIGNED
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

  const [curRows, prevRows] = await Promise.all([
    bancoPost<{
      totalEvaluations: number | string
      avgScore:         number | string | null
      passedEvaluations: number | string
      passRate:         number | string | null
    }>(periodQuery, [curFrom, curTo]),

    bancoPost<{
      totalEvaluations: number | string
      avgScore:         number | string | null
      passedEvaluations: number | string
      passRate:         number | string | null
    }>(periodQuery, [prevFrom, prevTo]),
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

  const rows = await bancoPost<{
    date:       string
    avg_score:  number | string | null
    passed:     number | string
    failed:     number | string
    total:      number | string
  }>(
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
    scoreTrend.push({
      date,
      value: r.avg_score != null ? Number(r.avg_score) : 0,
    })
    passFailTrend.push({
      date,
      value:  Number(r.passed),
      value2: Number(r.failed),
    })
    evalCountTrend.push({
      date,
      value: Number(r.total),
    })
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

  const rows = await bancoPost<{
    usecaseId:        number | string | null
    totalEvaluations: number | string
    avgScore:         number | string | null
    passRate:         number | string | null
    passed:           number | string
  }>(
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

  const rows = await bancoPost<{
    user_name: string
    sessions:  number | string
    avg_score: number | string | null
    pass_rate: number | string | null
  }>(
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

  const rows = await bancoPost<{
    savedReportId: number | string
    usecaseId:     number | string | null
    score:         number | string | null
    passed:        number | string
    date:          string
  }>(
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
