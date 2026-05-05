/**
 * bridge-banco.ts — Isolated Banco Analytics Pipeline
 *
 * STRICT ISOLATION RULES:
 * ✅ ONLY queries Banco-specific tables (coach_app.banco_users, coach_app.saved_reports, coach_app.saved_reports_options)
 * ❌ DO NOT mix with rolplay_pro_analytics data
 * ❌ DO NOT use customer_id (Banco uses banco_user_id hierarchy)
 * ❌ DO NOT import from data-provider.ts or bridge-client.ts
 *
 * Banco data model:
 *   banco_users.id → saved_reports.banco_user_id
 *   saved_reports.id → saved_reports_options.saved_report_id
 *
 * Banco employee structure:
 *   DIRECTOR (parent_emp_id = 0)
 *     └── REGIONAL (parent_emp_id = director.emp_id)
 */

// ── Config ────────────────────────────────────────────────────────────────────

function requireBridgeConfig() {
  const url    = process.env.BRIDGE_URL
  const secret = process.env.BRIDGE_SECRET
  if (!url)    throw new Error('BRIDGE_URL is not set')
  if (!secret) throw new Error('BRIDGE_SECRET is not set')
  return { url, secret }
}

// ── Core POST helper (isolated copy — avoids bridge-client.ts coupling) ───────

async function bancoPost<T>(
  sql:    string,
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

  if (!res.ok) throw new Error(`Banco Bridge HTTP ${res.status}`)

  const json = (await res.json()) as { success: boolean; data: T[]; error: string | null }
  if (!json.success) throw new Error(json.error ?? 'Banco Bridge error')
  return Array.isArray(json.data) ? json.data : []
}

/** ISO-8601 → MySQL DATETIME string (UTC) */
function isoToMysql(iso: string): string {
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')
}

// ── Public Types ──────────────────────────────────────────────────────────────

export interface BancoUser {
  id:            number
  emp_id:        number
  name:          string
  parent_emp_id: number
  position:      'DIRECTOR' | 'REGIONAL' | string
  hide_welcome:  boolean
}

export interface BancoSessionRow {
  report_id:        number
  banco_user_id:    number
  employee_name:    string
  position:         string
  date_created:     string
  rounds_completed: number
}

export interface BancoKpis {
  totalSessions:       number
  activeBancoUsers:    number
  totalBancoUsers:     number
  directorsCount:      number
  regionalsCount:      number
  avgRoundsPerSession: number
  sessionsByPosition:  { position: string; sessions: number }[]
  topPerformers:       { name: string; position: string; sessions: number; avgRounds: number }[]
  recentSessions:      BancoSessionRow[]
  hasData:             boolean
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all Banco users with their hierarchy.
 * No date filter — this is structural data.
 */
export async function bridgeBancoUsers(): Promise<BancoUser[]> {
  const rows = await bancoPost<{
    ID:            number | string
    emp_id:        number | string
    name:          string
    parent_emp_id: number | string
    position:      string
    hide_welcome:  number | string
  }>(
    `SELECT ID, emp_id, name, parent_emp_id, position, hide_welcome
     FROM coach_app.banco_users
     ORDER BY position DESC, name ASC`
  )

  return rows.map(r => ({
    id:            Number(r.ID),
    emp_id:        Number(r.emp_id),
    name:          r.name,
    parent_emp_id: Number(r.parent_emp_id),
    position:      r.position,
    hide_welcome:  Number(r.hide_welcome) === 1,
  }))
}

/**
 * Fetch Banco sessions with employee details for a date range.
 * Returns one row per session with aggregated round count.
 */
export async function bridgeBancoSessions(params: {
  fromIso: string
  toIso:   string
  limit?:  number
}): Promise<BancoSessionRow[]> {
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)
  const lim  = Math.max(1, Math.min(200, params.limit ?? 100))

  const rows = await bancoPost<{
    report_id:        number | string
    banco_user_id:    number | string
    employee_name:    string
    position:         string
    date_created:     string
    rounds_completed: number | string
  }>(
    `SELECT
       sr.id                                     AS report_id,
       bu.ID                                     AS banco_user_id,
       bu.name                                   AS employee_name,
       bu.position                               AS position,
       DATE(sr.date_created)                     AS date_created,
       COUNT(sro.id)                             AS rounds_completed
     FROM coach_app.saved_reports sr
     JOIN coach_app.banco_users bu
       ON bu.ID = sr.banco_user_id
     LEFT JOIN coach_app.saved_reports_options sro
       ON sro.saved_report_id = sr.id
     WHERE sr.banco_user_id > 0
       AND sr.date_created BETWEEN ? AND ?
     GROUP BY sr.id, bu.ID, bu.name, bu.position, sr.date_created
     ORDER BY sr.date_created DESC
     LIMIT ?`,
    [from, to, lim]
  )

  return rows.map(r => ({
    report_id:        Number(r.report_id),
    banco_user_id:    Number(r.banco_user_id),
    employee_name:    r.employee_name,
    position:         r.position,
    date_created:     String(r.date_created).slice(0, 10),
    rounds_completed: Number(r.rounds_completed),
  }))
}

/**
 * Aggregate Banco KPIs for a given date range.
 * This is the primary function for the Banco analytics page.
 */
export async function bridgeBancoKpis(params: {
  fromIso: string
  toIso:   string
}): Promise<BancoKpis> {
  const from = isoToMysql(params.fromIso)
  const to   = isoToMysql(params.toIso)

  const [summaryRows, byPositionRows, topPerformerRows, userCountRows] = await Promise.allSettled([
    // 1. Overall summary
    bancoPost<{
      total_sessions:        number | string
      active_banco_users:    number | string
      avg_rounds_per_session: number | string
    }>(
      `SELECT
         COUNT(DISTINCT sr.id)                                         AS total_sessions,
         COUNT(DISTINCT sr.banco_user_id)                              AS active_banco_users,
         ROUND(AVG(rnd.round_count), 1)                               AS avg_rounds_per_session
       FROM coach_app.saved_reports sr
       JOIN (
         SELECT saved_report_id, COUNT(*) AS round_count
         FROM coach_app.saved_reports_options
         GROUP BY saved_report_id
       ) rnd ON rnd.saved_report_id = sr.id
       WHERE sr.banco_user_id > 0
         AND sr.date_created BETWEEN ? AND ?`,
      [from, to]
    ),

    // 2. Sessions by position
    bancoPost<{ position: string; sessions: number | string }>(
      `SELECT
         bu.position,
         COUNT(DISTINCT sr.id) AS sessions
       FROM coach_app.saved_reports sr
       JOIN coach_app.banco_users bu ON bu.ID = sr.banco_user_id
       WHERE sr.banco_user_id > 0
         AND sr.date_created BETWEEN ? AND ?
       GROUP BY bu.position
       ORDER BY sessions DESC`,
      [from, to]
    ),

    // 3. Top performers by session count
    bancoPost<{
      employee_name: string
      position:      string
      sessions:      number | string
      avg_rounds:    number | string
    }>(
      `SELECT
         bu.name                                                       AS employee_name,
         bu.position,
         COUNT(DISTINCT sr.id)                                         AS sessions,
         ROUND(AVG(rnd.round_count), 1)                               AS avg_rounds
       FROM coach_app.saved_reports sr
       JOIN coach_app.banco_users bu ON bu.ID = sr.banco_user_id
       JOIN (
         SELECT saved_report_id, COUNT(*) AS round_count
         FROM coach_app.saved_reports_options
         GROUP BY saved_report_id
       ) rnd ON rnd.saved_report_id = sr.id
       WHERE sr.banco_user_id > 0
         AND sr.date_created BETWEEN ? AND ?
       GROUP BY bu.ID, bu.name, bu.position
       ORDER BY sessions DESC, avg_rounds DESC
       LIMIT 10`,
      [from, to]
    ),

    // 4. Total Banco user counts by position
    bancoPost<{ position: string; count: number | string }>(
      `SELECT position, COUNT(*) AS count
       FROM coach_app.banco_users
       GROUP BY position`
    ),
  ])

  // Safe extraction
  const summary  = summaryRows.status  === 'fulfilled' ? (summaryRows.value[0]  ?? null) : null
  const byPos    = byPositionRows.status === 'fulfilled' ? byPositionRows.value   : []
  const topPerf  = topPerformerRows.status === 'fulfilled' ? topPerformerRows.value : []
  const userCounts = userCountRows.status === 'fulfilled' ? userCountRows.value   : []

  const totalSessions       = Number(summary?.total_sessions ?? 0)
  const activeBancoUsers    = Number(summary?.active_banco_users ?? 0)
  const avgRoundsPerSession = Number(summary?.avg_rounds_per_session ?? 0)

  const directorsCount  = Number(userCounts.find(u => u.position === 'DIRECTOR')?.count ?? 0)
  const regionalsCount  = Number(userCounts.find(u => u.position === 'REGIONAL')?.count ?? 0)
  const totalBancoUsers = directorsCount + regionalsCount

  return {
    totalSessions,
    activeBancoUsers,
    totalBancoUsers,
    directorsCount,
    regionalsCount,
    avgRoundsPerSession,
    sessionsByPosition: byPos.map(r => ({
      position: r.position,
      sessions: Number(r.sessions),
    })),
    topPerformers: topPerf.map(r => ({
      name:       r.employee_name,
      position:   r.position,
      sessions:   Number(r.sessions),
      avgRounds:  Number(r.avg_rounds),
    })),
    recentSessions: [], // populated separately via bridgeBancoSessions
    hasData: totalSessions > 0,
  }
}
