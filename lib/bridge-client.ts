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

/**
 * Conditional CASE expression that normalises a score value to 0-100.
 * Scores ≤ 10 are assumed to be on a 0-10 scale and are multiplied by 10.
 * Used inline inside AVG() so NULL rows are correctly excluded.
 */
const SCORE_CASE = `
  CASE WHEN rfc.field_key IN ('overall_score','final_score')
       THEN CASE WHEN rfc.value_num <= 10
                 THEN rfc.value_num * 10
                 ELSE rfc.value_num
            END
       ELSE NULL
  END`

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
 *
 * FIX: Sessions are counted from ALL field rows (not just score-field rows).
 * This ensures modules whose sessions lack 'overall_score' (LMS, Simulator,
 * Certification) are still counted. Scores are computed conditionally via
 * SCORE_CASE so NULLs are excluded from AVG automatically.
 *
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
       COUNT(DISTINCT rfc.saved_report_id)                               AS total_sessions,
       ROUND(AVG(${SCORE_CASE}), 2)                                      AS avg_score,
       COUNT(DISTINCT CASE WHEN sr.passed_flag = 1
                           THEN rfc.saved_report_id END)                 AS passed,
       COUNT(DISTINCT rfc.saved_report_id)                               AS total_results
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     WHERE rfc.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
    p
  )

  const current = rows[0] ?? { total_sessions: 0, avg_score: null, passed: 0, total_results: 0 }
  return { current }
}

/**
 * Three trend series: score / pass-fail / session count.
 *
 * FIX: Removed AND rfc.field_key = 'overall_score' from count/pass-fail queries
 * so sessions without an overall_score field are still counted.
 * Score trend still filters to score fields (field_key IN ...) so AVG is valid.
 * Pass/fail and eval-count use DISTINCT saved_report_id — no double-counting.
 */
export async function bridgeTrends(params: {
  customerId:  number
  fromIso:     string
  toIso:       string
  usecaseIds?: number[]
}): Promise<unknown> {
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)

  // Separate param arrays — each query has its own copy so usecaseClause
  // can push into them independently without stomping the others.
  const scoreBase: (string | number | null)[] = [params.customerId, from, to]
  const countBase: (string | number | null)[] = [params.customerId, from, to]
  const ucScore = usecaseClause(params.usecaseIds, scoreBase)
  const ucCount = usecaseClause(params.usecaseIds, countBase)

  const joinBase = `
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id`

  const scoreWhere = `${joinBase}
    WHERE rfc.customer_id = ?
      AND rfc.report_created_at BETWEEN ? AND ?
      AND rfc.field_key IN ('overall_score','final_score')${ucScore}`

  const countWhere = `${joinBase}
    WHERE rfc.customer_id = ?
      AND rfc.report_created_at BETWEEN ? AND ?${ucCount}`

  const [scoreTrend, passFail, evalCount] = await Promise.all([
    bridgePost<{ date: string; avg_score: number }>(
      `SELECT DATE(rfc.report_created_at) AS date,
              ROUND(AVG(${SCORE_CASE}), 1) AS avg_score
       ${scoreWhere}
       GROUP BY DATE(rfc.report_created_at) ORDER BY date ASC LIMIT 90`,
      scoreBase
    ),
    bridgePost<{ date: string; passed: number; failed: number }>(
      `SELECT DATE(rfc.report_created_at) AS date,
              COUNT(DISTINCT CASE WHEN sr.passed_flag = 1
                                  THEN rfc.saved_report_id END) AS passed,
              COUNT(DISTINCT CASE WHEN sr.passed_flag = 0
                                  THEN rfc.saved_report_id END) AS failed
       ${countWhere}
       GROUP BY DATE(rfc.report_created_at) ORDER BY date ASC LIMIT 90`,
      [...countBase]
    ),
    bridgePost<{ date: string; sessions: number }>(
      `SELECT DATE(rfc.report_created_at) AS date,
              COUNT(DISTINCT rfc.saved_report_id) AS sessions
       ${countWhere}
       GROUP BY DATE(rfc.report_created_at) ORDER BY date ASC LIMIT 90`,
      [...countBase]
    ),
  ])

  return { score_trend: scoreTrend, pass_fail: passFail, eval_count: evalCount }
}

/**
 * Paginated evaluation results — one row per session.
 *
 * FIX: Removed field_key = 'overall_score' filter. Now groups by
 * saved_report_id so every session appears regardless of which score
 * field it uses. MAX(SCORE_CASE) picks up any normalised score value.
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
    `SELECT
       rfc.saved_report_id,
       MIN(rfc.usecase_id)                                         AS usecase_id,
       MAX(${SCORE_CASE})                                          AS score,
       MAX(sr.passed_flag)                                         AS passed_flag,
       DATE(MAX(rfc.report_created_at))                           AS report_created_at
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     WHERE rfc.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?${uc}
     GROUP BY rfc.saved_report_id
     ORDER BY MAX(rfc.report_created_at) DESC
     LIMIT ?`,
    p
  )
}

/**
 * Per-usecase breakdown with display names.
 *
 * FIX: Removed field_key = 'overall_score' filter. Uses SCORE_CASE in AVG
 * so only actual score fields contribute to avg_score. Uses DISTINCT
 * CASE WHEN for passed count to avoid row-level double-counting.
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
    `SELECT
       rfc.usecase_id,
       uc.usecase_name,
       COUNT(DISTINCT rfc.saved_report_id)                                    AS total_evaluations,
       ROUND(AVG(${SCORE_CASE}), 2)                                           AS avg_score,
       COUNT(DISTINCT CASE WHEN sr.passed_flag = 1
                           THEN rfc.saved_report_id END)                      AS passed,
       COUNT(DISTINCT rfc.saved_report_id)                                    AS total_results
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     LEFT JOIN coach_app.usecases uc ON uc.id = rfc.usecase_id
     WHERE rfc.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?${uc}
     GROUP BY rfc.usecase_id, uc.usecase_name
     ORDER BY total_evaluations DESC
     LIMIT 30`,
    p
  )
}

/**
 * Best performers — top users by average score.
 * Groups by user_email, requires at least 1 session, orders by avg score DESC.
 *
 * Live schema (confirmed via DESCRIBE):
 *   coach_app.coach_users  → id, user_email, user_name   (NO user_firstname/user_lastname)
 *   coach_app.saved_reports → id, coach_user_id          (NOT user_id)
 */
export async function bridgeBestPerformers(params: {
  customerId:  number
  fromIso:     string
  toIso:       string
  usecaseIds?: number[]
  limit?:      number
}): Promise<unknown> {
  // IMPORTANT: enforce tenant isolation on BOTH analytics rows (rfc.customer_id)
  // and the user table (coach_app.coach_users.customer_id). This prevents a
  // cross-tenant join from surfacing a user whose coach_users record belongs
  // to a different customer, even if analytics data is inconsistent.
  const p: (string | number | null)[] = [
    params.customerId, // rfc.customer_id
    params.customerId, // cu.customer_id
    isoToMysql(params.fromIso),
    isoToMysql(params.toIso),
  ]
  const uc  = usecaseClause(params.usecaseIds, p)
  const lim = Math.max(1, Math.min(50, params.limit ?? 10))
  p.push(lim)

  // FIX: Removed AND rfc.field_key = 'overall_score'. Uses SCORE_CASE so
  // only score fields influence avg_score. Pass rate uses DISTINCT session
  // IDs to avoid row-level inflation from multi-field reports.
  return bridgePost(
    `SELECT
       cu.user_email,
       cu.user_name,
       COUNT(DISTINCT rfc.saved_report_id)                                    AS sessions,
       ROUND(AVG(${SCORE_CASE}), 1)                                           AS avg_score,
       ROUND(
         COUNT(DISTINCT CASE WHEN sr.passed_flag = 1
                             THEN rfc.saved_report_id END)
         / NULLIF(COUNT(DISTINCT rfc.saved_report_id), 0) * 100
       , 1)                                                                   AS pass_rate
     FROM rolplay_pro_analytics.report_field_current rfc
     JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
     JOIN coach_app.coach_users cu  ON cu.id = sr.coach_user_id
     WHERE rfc.customer_id = ?
       AND cu.customer_id = ?
       AND rfc.report_created_at BETWEEN ? AND ?${uc}
     GROUP BY cu.id, cu.user_email, cu.user_name
     HAVING sessions >= 1
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

// ── Dynamic Usecase Discovery ────────────────────────────────────────────────

export interface UsecaseFieldInfo {
  usecase_id: number
  field_key: string
}

export interface UsecaseMetadata {
  id: number
  usecase_name: string | null
}

export interface UsecaseSummary {
  usecase_id: number
  sessions: number
}

/**
 * Spec Steps 1 + 2: Discover all usecases for a customer with their field
 * signatures and display names — used for dynamic module classification.
 *
 * No date filter: classification is structural (field patterns), not temporal.
 * No hardcoded IDs — everything is derived from live DB data.
 */
export async function bridgeDiscoverUsecaseFields(customerId: number): Promise<{
  usecases: UsecaseSummary[]
  fieldsByUsecase: Map<number, string[]>
  metadata: UsecaseMetadata[]
}> {
  // Step 1 — usecase IDs + field signatures (exact spec query)
  const usecaseRows = await bridgePost<{
    usecase_id: number | string
    fields: string | null
    sessions: number | string
  }>(
    `SELECT
       rfc.usecase_id,
       GROUP_CONCAT(DISTINCT rfc.field_key) AS fields,
       COUNT(DISTINCT rfc.saved_report_id)  AS sessions
     FROM rolplay_pro_analytics.report_field_current rfc
     WHERE rfc.customer_id = ?
     GROUP BY rfc.usecase_id
     ORDER BY sessions DESC`,
    [customerId]
  )

  if (usecaseRows.length === 0) {
    return { usecases: [], fieldsByUsecase: new Map(), metadata: [] }
  }

  const fieldsByUsecase = new Map<number, string[]>()
  const usecases: UsecaseSummary[] = []

  for (const row of usecaseRows) {
    const id = Number(row.usecase_id)
    usecases.push({ usecase_id: id, sessions: Number(row.sessions ?? 0) })
    fieldsByUsecase.set(
      id,
      row.fields ? row.fields.split(',').map(f => f.trim()).filter(Boolean) : []
    )
  }

  const usecaseIds = usecases.map(u => u.usecase_id)

  // Step 2 — display names from coach_app.usecases
  const metadata = await bridgePost<UsecaseMetadata>(
    `SELECT id, usecase_name
     FROM coach_app.usecases
     WHERE id IN (${usecaseIds.map(() => '?').join(',')})
     ORDER BY id`,
    [...usecaseIds]
  )

  return { usecases, fieldsByUsecase, metadata }
}

/**
 * @deprecated Use bridgeDiscoverUsecaseFields instead.
 * Kept for backward compatibility only.
 */
export async function discoverActiveUsecases(params: {
  customerId: number
  fromIso?: string
  toIso?: string
}): Promise<{
  usecases: UsecaseSummary[]
  fields: UsecaseFieldInfo[]
  metadata: UsecaseMetadata[]
}> {
  const { customerId } = params

  const { usecases, fieldsByUsecase, metadata } = await bridgeDiscoverUsecaseFields(customerId)

  // Flatten fieldsByUsecase back to UsecaseFieldInfo[] for legacy callers
  const fields: UsecaseFieldInfo[] = []
  for (const [usecase_id, keys] of fieldsByUsecase.entries()) {
    for (const field_key of keys) {
      fields.push({ usecase_id, field_key })
    }
  }

  return { usecases, fields, metadata }
}
