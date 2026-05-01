/**
 * bridge-client.ts — Next.js → PHP bridge adapter
 *
 * Bridge contract (read-only production dependency):
 *   URL    : process.env.BRIDGE_URL
 *   Method : POST
 *   Header : X-Bridge-Key: process.env.BRIDGE_SECRET
 *   Body   : { sql: string, params: (string|number|null)[] }
 *   Response: { success: boolean, data: unknown, error: string|null }
 *
 * All GET ?action= calls are NOT supported by the live bridge.
 * This file uses only POST { sql, params }.
 */

// ── Config ────────────────────────────────────────────────────────────────────

function requireBridgeConfig() {
  const url    = process.env.BRIDGE_URL
  const secret = process.env.BRIDGE_SECRET
  if (!url)    throw new Error('BRIDGE_URL is not set')
  if (!secret) throw new Error('BRIDGE_SECRET is not set')
  return { url, secret }
}

// ── Core POST helper ──────────────────────────────────────────────────────────

async function bridgePost<T>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  const { url, secret } = requireBridgeConfig()

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bridge-Key':  secret,
    },
    body:  JSON.stringify({ sql, params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) throw new Error(`Bridge HTTP ${res.status}`)

  const json = (await res.json()) as { success: boolean; data: T[]; error: string | null }
  if (!json.success) throw new Error(json.error ?? 'Bridge error')
  return Array.isArray(json.data) ? json.data : []
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** ISO-8601 → MySQL DATETIME string (UTC) */
function isoToMysql(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
}

/** Append " AND rfc.usecase_id IN (?,?,...)" and push ids into params */
function usecaseClause(
  usecaseIds: number[] | undefined,
  params: (string | number | null)[]
): string {
  if (!usecaseIds || usecaseIds.length === 0) return ''
  const placeholders = usecaseIds.map(() => '?').join(',')
  params.push(...usecaseIds)
  return ` AND rfc.usecase_id IN (${placeholders})`
}

// ── Public API (same signatures — data-provider.ts unchanged) ─────────────────

/**
 * Resolve email → customer_id at login time.
 * Table: coach_app.coach_users (columns: user_email, customer_id)
 */
export async function resolveCustomerIdByEmail(email: string): Promise<number | null> {
  const rows = await bridgePost<{ customer_id: number | string | null }>(
    'SELECT customer_id FROM coach_app.coach_users WHERE user_email = ? LIMIT 1',
    [email.toLowerCase().trim()]
  )
  const n = Number(rows[0]?.customer_id)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Overview KPIs for one time window.
 * data-provider.ts calls this twice (current + prior) when prev is missing.
 */
export async function bridgeOverviewKpis(params: {
  customerId:  number
  fromIso:     string
  toIso:       string
  usecaseIds?: number[]
}): Promise<unknown> {
  const p: (string | number | null)[] = [
    params.customerId,
    isoToMysql(params.fromIso),
    isoToMysql(params.toIso),
  ]
  const uc = usecaseClause(params.usecaseIds, p)

  const rows = await bridgePost<{
    total_sessions: number | string
    avg_score:      number | string | null
    passed:         number | string
    total_results:  number | string
  }>(
    `SELECT
       COUNT(DISTINCT rfc.saved_report_id)                       AS total_sessions,
       ROUND(AVG(rfc.value_num), 2)                              AS avg_score,
       SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END)       AS passed,
       COUNT(DISTINCT rfc.saved_report_id)                       AS total_results
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     WHERE rfc.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?
       AND rfc.field_key = 'overall_score'${uc}`,
    p
  )

  const current = rows[0] ?? { total_sessions: 0, avg_score: null, passed: 0, total_results: 0 }
  return { current }
}

/**
 * Three trend series: score / pass-fail / session count.
 */
export async function bridgeTrends(params: {
  customerId:  number
  fromIso:     string
  toIso:       string
  usecaseIds?: number[]
}): Promise<unknown> {
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)

  const base: (string | number | null)[] = [params.customerId, from, to]
  const uc = usecaseClause(params.usecaseIds, base)

  const whereClause = `
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
    WHERE rfc.customer_id = ?
      AND rfc.report_created_at BETWEEN ? AND ?
      AND rfc.field_key = 'overall_score'${uc}`

  const [scoreTrend, passFail, evalCount] = await Promise.all([
    bridgePost<{ date: string; avg_score: number }>(
      `SELECT DATE(rfc.report_created_at) AS date,
              ROUND(AVG(rfc.value_num), 1) AS avg_score
       ${whereClause}
       GROUP BY DATE(rfc.report_created_at) ORDER BY date ASC LIMIT 90`,
      [...base]
    ),
    bridgePost<{ date: string; passed: number; failed: number }>(
      `SELECT DATE(rfc.report_created_at) AS date,
              SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END) AS passed,
              SUM(CASE WHEN sr.passed_flag = 0 THEN 1 ELSE 0 END) AS failed
       ${whereClause}
       GROUP BY DATE(rfc.report_created_at) ORDER BY date ASC LIMIT 90`,
      [...base]
    ),
    bridgePost<{ date: string; sessions: number }>(
      `SELECT DATE(rfc.report_created_at) AS date,
              COUNT(DISTINCT rfc.saved_report_id) AS sessions
       ${whereClause}
       GROUP BY DATE(rfc.report_created_at) ORDER BY date ASC LIMIT 90`,
      [...base]
    ),
  ])

  return { score_trend: scoreTrend, pass_fail: passFail, eval_count: evalCount }
}

/**
 * Paginated evaluation results.
 */
export async function bridgeResults(params: {
  customerId:  number
  fromIso:     string
  toIso:       string
  usecaseIds?: number[]
  limit:       number
}): Promise<unknown> {
  const p: (string | number | null)[] = [
    params.customerId,
    isoToMysql(params.fromIso),
    isoToMysql(params.toIso),
  ]
  const uc  = usecaseClause(params.usecaseIds, p)
  const lim = Math.max(1, Math.min(200, params.limit))
  p.push(lim)

  return bridgePost(
    `SELECT rfc.saved_report_id,
            rfc.usecase_id,
            rfc.value_num                       AS score,
            sr.passed_flag,
            DATE(rfc.report_created_at)         AS report_created_at
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     WHERE rfc.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?
       AND rfc.field_key = 'overall_score'${uc}
     ORDER BY rfc.report_created_at DESC
     LIMIT ?`,
    p
  )
}

/**
 * Per-usecase breakdown with display names.
 */
export async function bridgeUsecaseBreakdown(params: {
  customerId:  number
  fromIso:     string
  toIso:       string
  usecaseIds?: number[]
}): Promise<unknown> {
  const p: (string | number | null)[] = [
    params.customerId,
    isoToMysql(params.fromIso),
    isoToMysql(params.toIso),
  ]
  const uc = usecaseClause(params.usecaseIds, p)

  return bridgePost(
    `SELECT rfc.usecase_id,
            uc.usecase_name,
            COUNT(DISTINCT rfc.saved_report_id)                   AS total_evaluations,
            ROUND(AVG(rfc.value_num), 2)                          AS avg_score,
            SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END)   AS passed,
            COUNT(DISTINCT rfc.saved_report_id)                   AS total_results
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     LEFT JOIN coach_app.usecases uc ON uc.id = rfc.usecase_id
     WHERE rfc.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?
       AND rfc.field_key = 'overall_score'${uc}
     GROUP BY rfc.usecase_id, uc.usecase_name
     ORDER BY total_evaluations DESC
     LIMIT 30`,
    p
  )
}

/**
 * Best performers — top users by average score.
 * Groups by user_email, requires at least 2 sessions, orders by avg score DESC.
 */
export async function bridgeBestPerformers(params: {
  customerId:  number
  fromIso:     string
  toIso:       string
  usecaseIds?: number[]
  limit?:      number
}): Promise<unknown> {
  const p: (string | number | null)[] = [
    params.customerId,
    isoToMysql(params.fromIso),
    isoToMysql(params.toIso),
  ]
  const uc  = usecaseClause(params.usecaseIds, p)
  const lim = Math.max(1, Math.min(50, params.limit ?? 10))
  p.push(lim)

  return bridgePost(
    `SELECT
       cu.user_email,
       cu.user_firstname,
       cu.user_lastname,
       COUNT(DISTINCT rfc.saved_report_id)                        AS sessions,
       ROUND(AVG(rfc.value_num), 1)                               AS avg_score,
       ROUND(SUM(CASE WHEN sr.passed_flag = 1 THEN 1 ELSE 0 END)
             / COUNT(DISTINCT rfc.saved_report_id) * 100, 1)      AS pass_rate
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     JOIN coach_app.coach_users cu  ON cu.id = sr.user_id
     WHERE rfc.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?
       AND rfc.field_key = 'overall_score'${uc}
     GROUP BY cu.id, cu.user_email, cu.user_firstname, cu.user_lastname
     HAVING sessions >= 2
     ORDER BY avg_score DESC, sessions DESC
     LIMIT ?`,
    p
  )
}

/**
 * Full drilldown for one saved_report, scoped to customer.
 */
export async function bridgeDrilldown(params: {
  customerId:    number
  savedReportId: number
}): Promise<unknown> {
  const { customerId, savedReportId } = params

  // Verify ownership + get created_at + usecase_id
  const header = await bridgePost<{
    report_created_at: string
    usecase_id: number | null
  }>(
    `SELECT report_created_at, usecase_id
     FROM rolplay_pro_analytics.report_field_current
     WHERE saved_report_id = ? AND customer_id = ?
     ORDER BY id ASC
     LIMIT 1`,
    [savedReportId, customerId]
  )

  if (!header[0]?.report_created_at) return null

  const [fields, payloadRows] = await Promise.all([
    bridgePost<{
      field_key:      string
      field_label:    string | null
      value_num:      number | null
      value_text:     string | null
      value_longtext: string | null
    }>(
      `SELECT field_key, field_label, value_num, value_text, value_longtext
       FROM rolplay_pro_analytics.report_field_current
       WHERE saved_report_id = ? AND customer_id = ?
       ORDER BY id ASC`,
      [savedReportId, customerId]
    ),
    bridgePost<{ closing_json: string | null }>(
      `SELECT closing_json
       FROM rolplay_pro_analytics.report_payload_current
       WHERE saved_report_id = ?
       LIMIT 1`,
      [savedReportId]
    ),
  ])

  return {
    saved_report_id:   savedReportId,
    usecase_id:        header[0].usecase_id ?? null,
    report_created_at: header[0].report_created_at,
    fields,
    closing_json:      payloadRows[0]?.closing_json ?? null,
  }
}
