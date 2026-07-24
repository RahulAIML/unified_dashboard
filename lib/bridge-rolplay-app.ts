/**
 * bridge-rolplay-app.ts
 *
 * Data adapter for clients on the standalone Rolplay app platform (the r_*
 * tables in rolplay.app), reached ONLY through the read-only raw-SQL endpoint
 * ROLPLAY_APP_SQL_URL (SELECT-only, enforced server-side).
 *
 * SCORES: the legacy r_user_session.score column is essentially never populated
 * on this platform, but the real overall score IS available per session:
 *   1. raw_closing_data (JSON) → "overall_score"  (recent sessions)
 *   2. closing_analysis (HTML) → a score <div>     (all sessions, incl. old ones)
 * The HTML marker differs per simulator family, so we try both known markers:
 *   - Siigo:  <div class="rp-sim-report-score-number">NN</div>
 *   - M8:     <div class="rpt-score-num">NN</div>
 * Extraction happens in SQL (SCORE_SQL below) so avg/pass-rate aggregate server
 * side; JSON is preferred and HTML is the fallback, covering ~100% of sessions.
 * Per-turn transcripts live in r_user_session_details (not surfaced here yet).
 *
 * Tenant resolution is by explicit login → client_id map (NOT email domain):
 * these clients share domains (Siigo, Diego, M8 ARCERA all use audioweb.com.mx),
 * and audioweb.com.mx also collides with a coach_app analytics customer — so a
 * domain rule would be ambiguous. Configure logins via ROLPLAY_APP_LOGINS
 * ("email:client_id,email:client_id"); a demo entry is built in.
 */

import type {
  OverviewApiResponse, ResultsApiResponse, EvaluationApiRow,
  TrendsApiResponse, ApiTrendPoint, UsecaseBreakdownApiResponse, UsecaseApiRow,
  BestPerformersApiResponse, BestPerformerRow,
} from './types'

const DEFAULT_SQL_URL = 'https://rolplay.app/ajax/remote-access.php'

function sqlUrl(): string {
  return process.env.ROLPLAY_APP_SQL_URL || DEFAULT_SQL_URL
}

/** Run a SELECT against the raw-SQL endpoint. Values are inlined by callers —
 *  callers MUST inline only integers they coerced themselves (never user text). */
async function remoteSelect<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const res = await fetch(sqlUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`rolplay-app SQL HTTP ${res.status}`)
  const json = (await res.json()) as { result?: string; data?: T[]; error?: string }
  if (json.result !== 'success') throw new Error(json.error ?? 'rolplay-app SQL error')
  return Array.isArray(json.data) ? json.data : []
}

// ── Login → client_id resolution ────────────────────────────────────────────

function loginMap(): Map<string, number> {
  // Built-in demo logins: Siigo (client_id 29) and M8 (client_id 24). Extend via
  // env (ROLPLAY_APP_LOGINS) with the real per-client logins without a deploy.
  // NOTE: M8 also has a pharma-bridge entry (acino.swiss / arceralifesciences.com
  // domains). resolveOrgType checks pharma BEFORE rolplay-app, so a real M8 user
  // on those domains resolves to the pharma pipeline, not client 24 here — the
  // two M8 configs need reconciling (see report).
  const map = new Map<string, number>([
    ['demo@siigo.com', 29],
    ['demo@m8.com', 24],
    ['demo@takeda.com', 13],
  ])
  const raw = process.env.ROLPLAY_APP_LOGINS ?? ''
  for (const entry of raw.split(',')) {
    const [email, id] = entry.split(':').map((s) => s?.trim())
    const n = Number(id)
    if (email && Number.isFinite(n) && n > 0) map.set(email.toLowerCase(), n)
  }
  return map
}

// Real users log in with their COMPANY email (e.g. adriana.losada@siigo.com),
// not the demo address — so resolution must be by domain, not exact email, or
// every real user resolves to no organization. Domain → client_id, verified
// from r_user. Extend via env ROLPLAY_APP_DOMAINS ("domain:client_id,...").
// audioweb.com.mx is deliberately excluded: it's the shared staff domain and
// spans several clients (Takeda/M8/Rowe), so it can't map to one.
const BUILTIN_DOMAIN_MAP: Record<string, number> = {
  'siigo.com': 29,
  'takeda.com': 13,
  'besins-healthcare.com': 14,
  'rowe.com.do': 25,
  'rowe.com': 25,
  // M8's real domain (arceralifesciences.com) is intentionally NOT here: it is
  // also the pharma M8 domain and resolveOrgType checks pharma first — the two
  // M8 configs must be reconciled before M8 can route to the query endpoint.
}

function domainMap(): Map<string, number> {
  const map = new Map<string, number>(Object.entries(BUILTIN_DOMAIN_MAP))
  for (const entry of (process.env.ROLPLAY_APP_DOMAINS ?? '').split(',')) {
    const [domain, id] = entry.split(':').map((s) => s?.trim().toLowerCase())
    const n = Number(id)
    if (domain && Number.isFinite(n) && n > 0) map.set(domain, n)
  }
  return map
}

/** Synchronous, no network — safe to call in the org-type hot path.
 *  Resolves the candidate client by exact login (demo) then domain. This only
 *  decides which PIPELINE a user belongs to; it does NOT grant data access —
 *  use resolveRolplayAppAccess for that (verifies the user is real). */
export function resolveRolplayAppClientId(email: string): number | null {
  const clean = email.toLowerCase().trim()
  const exact = loginMap().get(clean)
  if (exact) return exact
  const domain = clean.split('@')[1]
  return (domain && domainMap().get(domain)) || null
}

// ── Authorization (tenant isolation) ──────────────────────────────────────────
// Domain match is NOT authorization: anyone could register e.g. intruder@siigo.com
// and would otherwise inherit Siigo's data. Access is granted only if the email
// is a REAL user of that client in r_user. Verified against live data:
// adriana.losada@siigo.com → 1 (allowed); a fake @siigo.com → 0 (denied).
const userExistsCache = new Map<string, { ok: boolean; at: number }>()
const USER_EXISTS_TTL_MS = 10 * 60_000

async function rolplayAppUserExists(email: string, clientId: number): Promise<boolean> {
  const cid = Math.trunc(clientId)
  const clean = email.toLowerCase().trim()
  const key = `${cid}:${clean}`
  const cached = userExistsCache.get(key)
  if (cached && Date.now() - cached.at < USER_EXISTS_TTL_MS) return cached.ok

  const esc = clean.replace(/'/g, "''") // inlined, so escape quotes
  const rows = await remoteSelect<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM r_user WHERE LOWER(email) = '${esc}' AND client_id = ${cid}`,
  ).catch(() => [])
  const ok = Number(rows[0]?.n ?? 0) > 0
  userExistsCache.set(key, { ok, at: Date.now() })
  return ok
}

/**
 * Access-grant resolution. Returns the client_id ONLY for a user actually
 * authorized on that client (a real r_user), else null — so a domain squatter
 * is denied even though the domain resolves a tenant. Built-in demo logins
 * bypass the DB check (intentional test accounts). Use this anywhere data is
 * served; use resolveRolplayAppClientId only to pick the pipeline.
 */
export async function resolveRolplayAppAccess(email: string): Promise<number | null> {
  const clientId = resolveRolplayAppClientId(email)
  if (!clientId) return null
  if (loginMap().has(email.toLowerCase().trim())) return clientId
  return (await rolplayAppUserExists(email, clientId)) ? clientId : null
}

// ── Score extraction (SQL) ────────────────────────────────────────────────────

const PASS_THRESHOLD = 70 // platform-wide pass convention (matches every tenant)

/**
 * SQL expression yielding a 0-100 score per r_user_session row `s`, or NULL.
 *
 * PRIMARY (generic, all clients): raw_closing_data JSON `$.overall_score`. Every
 * session created going forward carries this, so a NEW client works with zero
 * extra config — nothing here is client-specific.
 *
 * FALLBACK (legacy sessions with empty raw_closing_data): the score lives in the
 * closing_analysis HTML, and the markup differs per report template. There is no
 * SQL-generic way to parse arbitrary HTML (confirmed with the platform owner), so
 * we keep a short, explicit, easily-extended list of known templates:
 *   - Siigo:  <div class="rp-sim-report-score-number">NN</div>
 *   - M8:     <div class="rpt-score-num">NN</div>
 *   - Takeda: <td class="total-score">NN / 100</td>   (take the part before '/')
 * Each branch is LOCATE-guarded so a missing marker never yields the whole blob;
 * SUBSTRING_INDEX(x, marker, -1) takes text after the marker, then '<' stops at
 * the tag close. To onboard a legacy client with a new template, add one branch.
 */
const SCORE_SQL = `CASE
  WHEN JSON_VALID(s.raw_closing_data)
       AND JSON_EXTRACT(s.raw_closing_data, '$.overall_score') IS NOT NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(s.raw_closing_data, '$.overall_score')) REGEXP '^[0-9]+(\\\\.[0-9]+)?$'
    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(s.raw_closing_data, '$.overall_score')) AS DECIMAL(6,2))
  WHEN LOCATE('rp-sim-report-score-number">', s.closing_analysis) > 0
    THEN CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis, 'rp-sim-report-score-number">', -1), '<', 1)) AS DECIMAL(6,2))
  WHEN LOCATE('rpt-score-num">', s.closing_analysis) > 0
    THEN CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis, 'rpt-score-num">', -1), '<', 1)) AS DECIMAL(6,2))
  WHEN LOCATE('total-score">', s.closing_analysis) > 0
    THEN CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis, 'total-score">', -1), '<', 1), '/', 1)) AS DECIMAL(6,2))
  ELSE NULL
END`

/** ISO → 'YYYY-MM-DD HH:MM:SS', stripped to digits/space/colon/dash so it is
 *  safe to inline (callers already pass Date.toISOString() output). */
function toSqlDt(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ').replace(/[^0-9 :-]/g, '')
}

function dateClause(fromIso?: string, toIso?: string): string {
  if (!fromIso || !toIso) return ''
  return ` AND s.date_created BETWEEN '${toSqlDt(fromIso)}' AND '${toSqlDt(toIso)}'`
}

interface ScoreStats { total: number; scored: number; avg: number | null; passed: number }

async function fetchScoreStats(cid: number, fromIso?: string, toIso?: string): Promise<ScoreStats> {
  const rows = await remoteSelect<{ total: number | string; scored: number | string; avg_score: string | null; passed: number | string }>(
    `SELECT COUNT(*) AS total,
            COUNT(sc) AS scored,
            ROUND(AVG(sc), 2) AS avg_score,
            SUM(CASE WHEN sc >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM (
         SELECT ${SCORE_SQL} AS sc
           FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
          WHERE u.client_id = ${cid}${dateClause(fromIso, toIso)}
       ) t`,
  ).catch(() => [])
  const r = rows[0]
  return {
    total:  Number(r?.total ?? 0),
    scored: Number(r?.scored ?? 0),
    avg:    r?.avg_score != null ? Number(r.avg_score) : null,
    passed: Number(r?.passed ?? 0),
  }
}

// ── Adapters ─────────────────────────────────────────────────────────────────

/** Overview with real scores extracted from raw_closing_data / closing_analysis. */
export async function rolplayAppOverview(
  clientId: number,
  range?: { fromIso: string; toIso: string },
): Promise<OverviewApiResponse> {
  const cid = Math.trunc(clientId)

  // Previous period = the equal-length window immediately before `from`.
  let prevRange: { fromIso: string; toIso: string } | undefined
  if (range) {
    const from = new Date(range.fromIso).getTime()
    const to   = new Date(range.toIso).getTime()
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) {
      prevRange = { fromIso: new Date(from - (to - from)).toISOString(), toIso: range.fromIso }
    }
  }

  const [cur, prev] = await Promise.all([
    fetchScoreStats(cid, range?.fromIso, range?.toIso),
    prevRange ? fetchScoreStats(cid, prevRange.fromIso, prevRange.toIso) : Promise.resolve<ScoreStats | null>(null),
  ])

  const passRate = (s: ScoreStats) => s.total > 0 ? Math.round((s.passed / s.total) * 1000) / 10 : null

  return {
    totalEvaluations:     cur.total,
    prevTotalEvaluations: prev?.total ?? 0,
    avgScore:             cur.avg,
    prevAvgScore:         prev?.avg ?? null,
    passRate:             passRate(cur),
    prevPassRate:         prev ? passRate(prev) : null,
    passedEvaluations:    cur.passed,
  }
}

export async function rolplayAppDataBounds(
  clientId: number,
): Promise<{ min: string; max: string } | null> {
  const cid = Math.trunc(clientId)
  const rows = await remoteSelect<{ min_date: string | null; max_date: string | null }>(
    `SELECT MIN(s.date_created) AS min_date, MAX(s.date_created) AS max_date
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}`,
  ).catch(() => [])
  const r = rows[0]
  if (!r?.min_date || !r?.max_date) return null
  return { min: String(r.min_date), max: String(r.max_date) }
}

/** Recent sessions as rows, with real extracted score + pass/fail result. */
export async function rolplayAppResults(
  clientId: number,
  limit: number,
  range?: { fromIso: string; toIso: string },
): Promise<ResultsApiResponse> {
  const cid = Math.trunc(clientId)
  const lim = Math.max(1, Math.min(200, Math.trunc(limit)))
  const rows = await remoteSelect<{
    id: number | string
    simulator_id: number | string | null
    date_created: string
    sc: string | null
  }>(
    `SELECT s.ID AS id, s.simulator_id, s.date_created, ${SCORE_SQL} AS sc
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}${dateClause(range?.fromIso, range?.toIso)}
      ORDER BY s.date_created DESC
      LIMIT ${lim}`,
  ).catch(() => [])

  const data: EvaluationApiRow[] = rows.map((r) => {
    const score = r.sc != null ? Number(r.sc) : null
    const passed = score != null && score >= PASS_THRESHOLD
    return {
      savedReportId: Number(r.id),
      usecaseId: r.simulator_id != null ? Number(r.simulator_id) : null,
      usecaseName: null,    // simulator display name not joined here
      score,
      result: score != null ? (passed ? 'pass' : 'fail') : null,
      passed,
      date: String(r.date_created).slice(0, 10),
    }
  })
  return { data }
}

/** Daily trends (score + counts + pass) and a score-distribution histogram. */
export async function rolplayAppTrends(
  clientId: number,
  range?: { fromIso: string; toIso: string },
): Promise<TrendsApiResponse> {
  const cid = Math.trunc(clientId)
  const dc = dateClause(range?.fromIso, range?.toIso)

  const daily = await remoteSelect<{ day: string; sessions: number | string; avg: string | null; passed: number | string }>(
    `SELECT day, COUNT(*) AS sessions, ROUND(AVG(sc),2) AS avg,
            SUM(CASE WHEN sc >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM (SELECT DATE(s.date_created) AS day, ${SCORE_SQL} AS sc
               FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
              WHERE u.client_id = ${cid}${dc}) t
      GROUP BY day ORDER BY day`,
  ).catch(() => [])

  const scoreTrend: ApiTrendPoint[] = daily.filter(r => r.avg != null).map(r => ({ date: String(r.day).slice(0, 10), value: Number(r.avg) }))
  const evalCountTrend: ApiTrendPoint[] = daily.map(r => ({ date: String(r.day).slice(0, 10), value: Number(r.sessions) }))
  const passFailTrend: ApiTrendPoint[] = daily.map(r => ({ date: String(r.day).slice(0, 10), value: Number(r.passed) }))

  const buckets = await remoteSelect<{ bucket: number | string; count: number | string }>(
    `SELECT LEAST(FLOOR(sc/10)*10,90) AS bucket, COUNT(*) AS count
       FROM (SELECT ${SCORE_SQL} AS sc FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
              WHERE u.client_id = ${cid}${dc}) t
      WHERE sc IS NOT NULL GROUP BY bucket ORDER BY bucket`,
  ).catch(() => [])
  const totalScored = buckets.reduce((s, b) => s + Number(b.count), 0) || 1
  const scoreDistribution = buckets.map(b => {
    const lo = Number(b.bucket)
    return { range: `${lo}-${lo < 90 ? lo + 9 : 100}`, count: Number(b.count), pct: Math.round((Number(b.count) / totalScored) * 1000) / 10 }
  })

  return { scoreTrend, passFailTrend, evalCountTrend, scoreDistribution }
}

/** Per-simulator breakdown (the "use cases" for a query-endpoint client). */
export async function rolplayAppUsecaseBreakdown(
  clientId: number,
  range?: { fromIso: string; toIso: string },
): Promise<UsecaseBreakdownApiResponse> {
  const cid = Math.trunc(clientId)
  const dc = dateClause(range?.fromIso, range?.toIso)
  const rows = await remoteSelect<{ simulator_id: number | string; name: string | null; total: number | string; avg: string | null; passed: number | string }>(
    `SELECT s.simulator_id, sim.name,
            COUNT(*) AS total, ROUND(AVG(${SCORE_SQL}),2) AS avg,
            SUM(CASE WHEN (${SCORE_SQL}) >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
       LEFT JOIN r_simulator sim ON sim.ID = s.simulator_id
      WHERE u.client_id = ${cid}${dc}
      GROUP BY s.simulator_id, sim.name ORDER BY total DESC`,
  ).catch(() => [])

  const data: UsecaseApiRow[] = rows.map(r => {
    const total = Number(r.total)
    const passed = Number(r.passed)
    return {
      usecaseId: Number(r.simulator_id),
      usecase_name: r.name?.trim() || `Simulator ${r.simulator_id}`,
      totalEvaluations: total,
      avgScore: r.avg != null ? Number(r.avg) : null,
      passRate: total ? Math.round((passed / total) * 1000) / 10 : null,
      passed,
    }
  })
  return { data }
}

/** Top users by average score. */
export async function rolplayAppBestPerformers(
  clientId: number,
  limit: number,
  range?: { fromIso: string; toIso: string },
): Promise<BestPerformersApiResponse> {
  const cid = Math.trunc(clientId)
  const lim = Math.max(1, Math.min(50, Math.trunc(limit)))
  const dc = dateClause(range?.fromIso, range?.toIso)
  const rows = await remoteSelect<{ email: string; name: string | null; sessions: number | string; avg: string | null; passed: number | string }>(
    `SELECT u.email, u.name,
            COUNT(*) AS sessions, ROUND(AVG(${SCORE_SQL}),2) AS avg,
            SUM(CASE WHEN (${SCORE_SQL}) >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}${dc}
      GROUP BY u.ID, u.email, u.name
      HAVING COUNT(${SCORE_SQL}) > 0
      ORDER BY avg DESC, sessions DESC
      LIMIT ${lim}`,
  ).catch(() => [])

  const data: BestPerformerRow[] = rows.map(r => {
    const sessions = Number(r.sessions)
    const passed = Number(r.passed)
    return {
      user_email: r.email,
      user_name: r.name?.trim() || null,
      sessions,
      avg_score: r.avg != null ? Number(r.avg) : 0,
      pass_rate: sessions ? Math.round((passed / sessions) * 1000) / 10 : 0,
    }
  })
  return { data }
}
