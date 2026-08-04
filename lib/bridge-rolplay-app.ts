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

/**
 * Statements this client is permitted to send.
 *
 * Defence in depth, and deliberately client-side. The endpoint is documented as
 * "SELECT-only, enforced server-side", but that enforcement lives in a PHP file
 * outside this repository and is not verifiable from here. This guard makes it
 * impossible for THIS codebase to send a mutating statement even by mistake —
 * a future caller cannot accidentally turn a read path into a write one.
 *
 * Rejects stacked statements too: a ';' followed by anything else would let one
 * SELECT smuggle a second statement past a naive server-side prefix check.
 */
function assertReadOnly(sql: string): void {
  const trimmed = sql.trim()
  if (!/^select\s/i.test(trimmed) && !/^with\s/i.test(trimmed)) {
    throw new Error('rolplay-app SQL: only SELECT/WITH statements may be sent')
  }
  // Allow one optional trailing semicolon; anything after it is a second statement.
  if (/;\s*\S/.test(trimmed)) {
    throw new Error('rolplay-app SQL: stacked statements are not permitted')
  }
}

/** Run a SELECT against the raw-SQL endpoint. Values are inlined by callers —
 *  callers MUST inline only integers they coerced themselves (never user text). */
async function remoteSelect<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  assertReadOnly(sql)

  // Attach a shared secret when configured.
  //
  // As of this commit the endpoint accepts UNAUTHENTICATED requests: this client
  // sends only Content-Type, and the integration works in production, so the
  // server cannot be requiring a credential. Combined with a public default host
  // that is an internet-reachable arbitrary-SQL endpoint on the production
  // database. See docs/ARCHITECTURE_AUDIT.md S2 -- it is a live exposure, not a
  // future risk.
  //
  // Sending the header now means the cutover is a server-side change plus one
  // environment variable, with no code deploy needed at the moment the endpoint
  // starts requiring auth.
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = process.env.ROLPLAY_APP_SQL_TOKEN
  if (token) headers['X-Rolplay-Auth'] = token

  const res = await fetch(sqlUrl(), {
    method: 'POST',
    headers,
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

// ── DB-backed domain mapping (self-service publishing) ────────────────────────
// The builder's publish step writes rolplay_app_domains, so a NEWLY published
// query-endpoint client resolves without a deploy. The code/env maps above stay
// as a fallback (and for local dev without the table).
let dbDomainCache: { map: Map<string, number>; at: number } | null = null
const DB_DOMAIN_TTL_MS = 60_000

async function dbDomainMap(): Promise<Map<string, number>> {
  if (dbDomainCache && Date.now() - dbDomainCache.at < DB_DOMAIN_TTL_MS) return dbDomainCache.map
  const map = new Map<string, number>()
  try {
    const { authQuery } = await import('./db-auth')
    const rows = await authQuery<{ domain: string; client_id: number }>(
      `SELECT domain, client_id FROM rolplay_app_domains WHERE is_active = TRUE`,
    )
    for (const r of rows) map.set(String(r.domain).toLowerCase(), Number(r.client_id))
  } catch {
    // Table not migrated yet / DB unreachable → fall back to the code+env maps.
  }
  dbDomainCache = { map, at: Date.now() }
  return map
}

/** Drop the cached DB domain map (call after a publish/admin write). */
export function invalidateRolplayAppDomainCache(): void {
  dbDomainCache = null
}

/**
 * Pipeline resolution including DB-published domains. Prefer this wherever an
 * await is possible; resolveRolplayAppClientId stays for sync callers.
 */
export async function resolveRolplayAppClientIdAsync(email: string): Promise<number | null> {
  const sync = resolveRolplayAppClientId(email)
  if (sync) return sync
  const domain = email.toLowerCase().trim().split('@')[1]
  if (!domain) return null
  return (await dbDomainMap()).get(domain) ?? null
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
  const clientId = await resolveRolplayAppClientIdAsync(email)
  if (!clientId) return null
  if (loginMap().has(email.toLowerCase().trim())) return clientId
  return (await rolplayAppUserExists(email, clientId)) ? clientId : null
}

// ── Score extraction (SQL) ────────────────────────────────────────────────────

const PASS_THRESHOLD = 70 // platform-wide pass convention (matches every tenant)

/**
 * SQL expression yielding a 0-100 score per r_user_session row `s`, or NULL.
 *
 * PRIMARY (generic, all clients): raw_closing_data JSON. Prefer `$.score_bar`
 * when present, else `$.overall_score`. This matters because the scales differ
 * per module — verified across all live sessions:
 *   SIM     overall_score 0-95, no score_bar   → overall_score IS the 0-100 score
 *   COACH   overall_score 0-9  + score_bar 0-90 (137/137) → score_bar is 0-100
 *   SEGMENT overall_score 86,  no score_bar    → overall_score
 * Using overall_score blindly gave Master Coach an avg of 3.95 (a 0-10 scale
 * averaged as if 0-100). score_bar-first is data-driven, not per-client.
 *
 * FALLBACK (legacy sessions with empty raw_closing_data): the score lives in the
 * closing_analysis HTML, and the markup differs per report template. There is no
 * SQL-generic way to parse arbitrary HTML (confirmed with the platform owner), so
 * we keep a short, explicit, easily-extended list of known templates:
 *   - Siigo:  <div class="rp-sim-report-score-number">NN</div>
 *   - M8:     <div class="rpt-score-num">NN</div>
 *   - Takeda: <td class="total-score">NN / 100</td>   (take the part before '/')
 *   - Master Coach (rp-coach-report): <div class="score-number">N</div> with a
 *     "/ 10" denominator — verified across live sessions (9,6,6,7,4,2 all /10),
 *     so it is x10 (capped at 100) to reach the 0-100 scale.
 * ORDER MATTERS: Siigo's marker 'rp-sim-report-score-number">' CONTAINS
 * 'score-number">', so the Master Coach branch must stay LAST — SIM sessions
 * match their own branch first and never fall through to the x10 branch.
 * Each branch is LOCATE-guarded so a missing marker never yields the whole blob;
 * SUBSTRING_INDEX(x, marker, -1) takes text after the marker, then '<' stops at
 * the tag close. To onboard a legacy client with a new template, add one branch.
 */
const SCORE_SQL = `CASE
  WHEN JSON_VALID(s.raw_closing_data)
       AND JSON_EXTRACT(s.raw_closing_data, '$.score_bar') IS NOT NULL
       AND JSON_UNQUOTE(JSON_EXTRACT(s.raw_closing_data, '$.score_bar')) REGEXP '^[0-9]+(\\\\.[0-9]+)?$'
    THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(s.raw_closing_data, '$.score_bar')) AS DECIMAL(6,2))
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
  WHEN LOCATE('score-number">', s.closing_analysis) > 0
    THEN LEAST(CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis, 'score-number">', -1), '<', 1)) AS DECIMAL(6,2)) * 10, 100)
  WHEN LOCATE('rp-huge-grade">', s.closing_analysis) > 0
    THEN LEAST(CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(s.closing_analysis, 'rp-huge-grade">', -1), '<', 1)) AS DECIMAL(6,2)) * 10, 100)
  ELSE NULL
END`

/** ISO → 'YYYY-MM-DD HH:MM:SS', stripped to digits/space/colon/dash so it is
 *  safe to inline (callers already pass Date.toISOString() output). */
function toSqlDt(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ').replace(/[^0-9 :-]/g, '')
}

// ── Module (solution) mapping ─────────────────────────────────────────────────
// r_simulator.category is the platform's own module tag. Dashboard naming is
// deliberately preserved (per product decision):
//   COACH   → "Master Coach"      (schema calls it coach)
//   SEGMENT → "Certifier Coach"   (schema calls it certification/segmented)
//   SIM     → "Simulator"
// Verified live: M8 has SIM+COACH+SEGMENT, Siigo SIM only, Rowe COACH+SIM.
//
// Second Brain is deliberately NOT sourced here. Even though this schema has an
// 'SB' category, Second Brain data comes exclusively from the dedicated Second
// Brain API (lib/second-brain-api.ts, per-org admin_email) — that stays intact.
// So SB sessions in r_user_session are ignored by this connector.
//
// To be explicit, because the omission reads like an oversight and has been
// questioned more than once: r_simulator.category has FOUR values (COACH, SIM,
// SEGMENT, SB) and only three are mapped above. The fourth is excluded on
// purpose, not forgotten. Do not add `'second-brain': 'SB'` here — it would
// give Second Brain two disagreeing sources. lib/journey.ts repeats this note
// where the journey view consumes both.
const SOLUTION_TO_CATEGORY: Record<string, string> = {
  coach: 'COACH',
  simulator: 'SIM',
  certification: 'SEGMENT',
}

/** SQL fragment restricting sessions to one dashboard solution, or '' for all.
 *  Uses a subquery (not a join) so it can be appended to any WHERE without
 *  colliding with an existing r_simulator alias. */
function categoryClause(solution?: string | null): string {
  const cat = solution ? SOLUTION_TO_CATEGORY[solution] : undefined
  if (!cat) return ''
  return ` AND s.simulator_id IN (SELECT ID FROM r_simulator WHERE category = '${cat}')`
}

/**
 * Which dashboard modules this client actually has data for — drives dynamic
 * rendering so a client sees only their contracted/used services (no empty
 * tabs, no fabricated zeros). Derived from real sessions, so a newly-used
 * module appears automatically.
 */
export async function rolplayAppAvailableModules(clientId: number): Promise<string[]> {
  const cid = Math.trunc(clientId)
  const rows = await remoteSelect<{ category: string | null; n: number | string }>(
    `SELECT sim.category AS category, COUNT(*) AS n
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
       LEFT JOIN r_simulator sim ON sim.ID = s.simulator_id
      WHERE u.client_id = ${cid}
      GROUP BY sim.category`,
  ).catch(() => [])
  const present = new Set(
    rows.filter(r => Number(r.n) > 0 && r.category).map(r => String(r.category).toUpperCase()),
  )
  return Object.entries(SOLUTION_TO_CATEGORY)
    .filter(([, cat]) => present.has(cat))
    .map(([solution]) => solution)
}

function dateClause(fromIso?: string, toIso?: string): string {
  if (!fromIso || !toIso) return ''
  return ` AND s.date_created BETWEEN '${toSqlDt(fromIso)}' AND '${toSqlDt(toIso)}'`
}

interface ScoreStats { total: number; scored: number; avg: number | null; passed: number }

async function fetchScoreStats(cid: number, fromIso?: string, toIso?: string, solution?: string | null): Promise<ScoreStats> {
  const rows = await remoteSelect<{ total: number | string; scored: number | string; avg_score: string | null; passed: number | string }>(
    `SELECT COUNT(*) AS total,
            COUNT(sc) AS scored,
            ROUND(AVG(sc), 2) AS avg_score,
            SUM(CASE WHEN sc >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM (
         SELECT ${SCORE_SQL} AS sc
           FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
          WHERE u.client_id = ${cid}${dateClause(fromIso, toIso)}${categoryClause(solution)}
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
  solution?: string | null,
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
    fetchScoreStats(cid, range?.fromIso, range?.toIso, solution),
    prevRange ? fetchScoreStats(cid, prevRange.fromIso, prevRange.toIso, solution) : Promise.resolve<ScoreStats | null>(null),
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
  solution?: string | null,
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
      WHERE u.client_id = ${cid}${dateClause(range?.fromIso, range?.toIso)}${categoryClause(solution)}
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
  solution?: string | null,
): Promise<TrendsApiResponse> {
  const cid = Math.trunc(clientId)
  const dc = dateClause(range?.fromIso, range?.toIso)

  const daily = await remoteSelect<{ day: string; sessions: number | string; avg: string | null; passed: number | string }>(
    `SELECT day, COUNT(*) AS sessions, ROUND(AVG(sc),2) AS avg,
            SUM(CASE WHEN sc >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM (SELECT DATE(s.date_created) AS day, ${SCORE_SQL} AS sc
               FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
              WHERE u.client_id = ${cid}${dc}${categoryClause(solution)}) t
      GROUP BY day ORDER BY day`,
  ).catch(() => [])

  const scoreTrend: ApiTrendPoint[] = daily.filter(r => r.avg != null).map(r => ({ date: String(r.day).slice(0, 10), value: Number(r.avg) }))
  const evalCountTrend: ApiTrendPoint[] = daily.map(r => ({ date: String(r.day).slice(0, 10), value: Number(r.sessions) }))
  const passFailTrend: ApiTrendPoint[] = daily.map(r => ({ date: String(r.day).slice(0, 10), value: Number(r.passed) }))

  const buckets = await remoteSelect<{ bucket: number | string; count: number | string }>(
    `SELECT LEAST(FLOOR(sc/10)*10,90) AS bucket, COUNT(*) AS count
       FROM (SELECT ${SCORE_SQL} AS sc FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
              WHERE u.client_id = ${cid}${dc}${categoryClause(solution)}) t
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
  solution?: string | null,
): Promise<UsecaseBreakdownApiResponse> {
  const cid = Math.trunc(clientId)
  const dc = dateClause(range?.fromIso, range?.toIso)
  const rows = await remoteSelect<{ simulator_id: number | string; name: string | null; total: number | string; avg: string | null; passed: number | string }>(
    `SELECT s.simulator_id, sim.name,
            COUNT(*) AS total, ROUND(AVG(${SCORE_SQL}),2) AS avg,
            SUM(CASE WHEN (${SCORE_SQL}) >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
       LEFT JOIN r_simulator sim ON sim.ID = s.simulator_id
      WHERE u.client_id = ${cid}${dc}${categoryClause(solution)}
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
  solution?: string | null,
): Promise<BestPerformersApiResponse> {
  const cid = Math.trunc(clientId)
  const lim = Math.max(1, Math.min(50, Math.trunc(limit)))
  const dc = dateClause(range?.fromIso, range?.toIso)
  const rows = await remoteSelect<{ email: string; name: string | null; sessions: number | string; avg: string | null; passed: number | string }>(
    `SELECT u.email, u.name,
            COUNT(*) AS sessions, ROUND(AVG(${SCORE_SQL}),2) AS avg,
            SUM(CASE WHEN (${SCORE_SQL}) >= ${PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}${dc}${categoryClause(solution)}
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

// ── Cesar KPIs (Sugerencia de KPI's Cesar.xlsx) ──────────────────────────────
//
// TypeScript port of ai-service/app/preview_fetch.py's
// _rolplay_app_cesar_metrics / _commercial_domain_rows / _rubrica_tag_counts /
// _adoption_movement_rate / _mastery_distribution_rows -- same two groups,
// same anti-fabrication rules, kept in sync so a rolplay-app tenant sees
// identical numbers whether they're viewing the hand-built dashboard or an
// AI-generated one.
//
// GROUP 1 (schema-only, works for any rolplay-app tenant): activation rate,
// weekly practice frequency, MAU, practices-to-mastery, competency gain
// (delta score), field readiness index, mastery distribution.
//
// GROUP 2 (depends on raw_closing_data carrying a rich per-session
// evaluation JSON -- confirmed real for Siigo, confirmed ABSENT for Takeda):
// commercial-domain breakdown, top strengths/opportunities, adoption
// movement rate. Discovers bloque_*/rubrica_pN_* keys dynamically via regex,
// never a hardcoded field list -- works for any product whose evaluator
// produces this shape, reports empty/null (never a fabricated value) for
// one that doesn't.
//
// NOT implemented, same reasons as the Python port: KPI-2.1 Time-to-Mastery
// (no duration column exists anywhere in r_user_session), KPI-3.1/3.3/5.2
// (would require classifying free-text fields into fixed categories --
// fabrication risk), KPI-4.4 (would double-count the commercial-domain
// widget's own "Romper el No" data under a different label).

const MASTERY_THRESHOLD = 95 // "certified"/"mastery" bar -- distinct from PASS_THRESHOLD (70)
const _CLOSING_DATA_SAMPLE_LIMIT = 500 // bounded scan, matches the Reports table's own cap

export interface CesarGroup1Kpis {
  activationRate: number | null
  weeklyPracticeFrequency: number | null
  mauRate: number | null
  practicesToMastery: number | null
  deltaScore: number | null
  readinessIndex: number | null
  masteryDistribution: { label: string; value: number; pct: number }[]
}

/** KPI-1.1/1.3/1.4/2.2/2.3/3.2/5.3. Per-user sequencing (delta score,
 *  practices-to-mastery, readiness, mastery distribution) is done in JS
 *  after fetching one bounded (user_id, score) row set, mirroring the
 *  Python port's own approach -- simpler and more testable than nested
 *  correlated SQL re-deriving SCORE_SQL inside a subquery. */
export async function rolplayAppCesarGroup1(
  clientId: number,
  range?: { fromIso: string; toIso: string },
  solution?: string | null,
): Promise<CesarGroup1Kpis> {
  const cid = Math.trunc(clientId)
  const dc = dateClause(range?.fromIso, range?.toIso)
  const cat = categoryClause(solution)
  const round1 = (n: number) => Math.round(n * 10) / 10

  const enrolledRows = await remoteSelect<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM r_user u WHERE u.client_id = ${cid}`,
  ).catch(() => [])
  const enrolled = Number(enrolledRows[0]?.n ?? 0)

  const activeRows = await remoteSelect<{ n: number | string; sessions: number | string; weeks: number | string }>(
    `SELECT COUNT(DISTINCT s.user_id) AS n, COUNT(*) AS sessions,
            COUNT(DISTINCT YEARWEEK(s.date_created)) AS weeks
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}${cat}${dc}`,
  ).catch(() => [])
  const activeUsers = Number(activeRows[0]?.n ?? 0)
  const periodSessions = Number(activeRows[0]?.sessions ?? 0)
  const activeWeeks = Number(activeRows[0]?.weeks ?? 0)

  // MAU: a real 30-day recency window, independent of whatever wider range
  // the dashboard's own date filter currently shows.
  let mauUsers = 0
  if (range?.toIso) {
    const toDate = range.toIso.slice(0, 10)
    const mauRows = await remoteSelect<{ n: number | string }>(
      `SELECT COUNT(DISTINCT s.user_id) AS n FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
        WHERE u.client_id = ${cid}${cat} AND s.date_created >= DATE_SUB('${toDate}', INTERVAL 30 DAY)
          AND s.date_created <= '${toDate} 23:59:59'`,
    ).catch(() => [])
    mauUsers = Number(mauRows[0]?.n ?? 0)
  }

  const seqRows = await remoteSelect<{ user_id: number | string; sc: string | null }>(
    `SELECT s.user_id, (${SCORE_SQL}) AS sc
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}${cat}${dc} AND (${SCORE_SQL}) IS NOT NULL
      ORDER BY s.user_id, s.date_created ASC
      LIMIT ${_CLOSING_DATA_SAMPLE_LIMIT}`,
  ).catch(() => [])

  const byUser = new Map<string, number[]>()
  for (const r of seqRows) {
    const sc = Number(r.sc)
    if (!Number.isFinite(sc)) continue
    const key = String(r.user_id)
    const arr = byUser.get(key) ?? []
    arr.push(sc)
    byUser.set(key, arr)
  }

  const deltas: number[] = []
  const practices: number[] = []
  let mastered = 0
  for (const scores of byUser.values()) {
    if (scores.length >= 2) deltas.push(scores[scores.length - 1] - scores[0])
    const idx = scores.findIndex(s => s >= MASTERY_THRESHOLD)
    if (idx >= 0) practices.push(idx + 1)
    if (scores.some(s => s >= MASTERY_THRESHOLD)) mastered++
  }

  const allScores = seqRows.map(r => Number(r.sc)).filter(n => Number.isFinite(n))
  const basic = allScores.filter(s => s < 75).length
  const intermediate = allScores.filter(s => s >= 75 && s < MASTERY_THRESHOLD).length
  const advanced = allScores.filter(s => s >= MASTERY_THRESHOLD).length
  const totalScored = allScores.length
  const masteryDistribution = totalScored ? [
    { label: 'Basic (<75)', value: basic, pct: round1(100 * basic / totalScored) },
    { label: 'Intermediate (75-94)', value: intermediate, pct: round1(100 * intermediate / totalScored) },
    { label: 'Advanced (>=95)', value: advanced, pct: round1(100 * advanced / totalScored) },
  ] : []

  return {
    activationRate: enrolled ? round1(100 * activeUsers / enrolled) : null,
    weeklyPracticeFrequency: activeWeeks ? round1(periodSessions / activeWeeks) : null,
    mauRate: enrolled ? round1(100 * mauUsers / enrolled) : null,
    practicesToMastery: practices.length ? round1(practices.reduce((a, b) => a + b, 0) / practices.length) : null,
    deltaScore: deltas.length ? round1(deltas.reduce((a, b) => a + b, 0) / deltas.length) : null,
    readinessIndex: enrolled ? round1(100 * mastered / enrolled) : null,
    masteryDistribution,
  }
}

async function rolplayAppClosingDataRows(
  clientId: number,
  range?: { fromIso: string; toIso: string },
  solution?: string | null,
): Promise<Record<string, unknown>[]> {
  const cid = Math.trunc(clientId)
  const dc = dateClause(range?.fromIso, range?.toIso)
  const cat = categoryClause(solution)
  const rows = await remoteSelect<{ d: string | null }>(
    `SELECT s.raw_closing_data AS d FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}${cat}${dc} AND s.raw_closing_data IS NOT NULL
      ORDER BY s.date_created DESC LIMIT ${_CLOSING_DATA_SAMPLE_LIMIT}`,
  ).catch(() => [])
  const out: Record<string, unknown>[] = []
  for (const r of rows) {
    if (!r.d) continue
    try {
      const parsed: unknown = JSON.parse(r.d)
      if (parsed && typeof parsed === 'object') out.push(parsed as Record<string, unknown>)
    } catch {
      // invalid JSON -- skip, never fabricate a row for it
    }
  }
  return out
}

export interface CommercialDomainRow { domain: string; avgScore: number; sessions: number }

/** KPI-4.1: averages whichever 'bloque_<name>_score' keys each session's
 *  evaluator actually produced -- discovered via regex, never a hardcoded
 *  block list or count. */
export async function rolplayAppCommercialDomain(
  clientId: number, range?: { fromIso: string; toIso: string }, solution?: string | null,
): Promise<CommercialDomainRow[]> {
  const parsed = await rolplayAppClosingDataRows(clientId, range, solution)
  const scores = new Map<string, number[]>()
  const re = /^bloque_(.+)_score$/
  for (const d of parsed) {
    for (const [k, v] of Object.entries(d)) {
      const m = re.exec(k)
      if (!m) continue
      const num = Number(v)
      if (!Number.isFinite(num)) continue
      const arr = scores.get(m[1]) ?? []
      arr.push(num)
      scores.set(m[1], arr)
    }
  }
  const out = Array.from(scores.entries()).map(([name, vals]) => ({
    domain: name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    avgScore: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    sessions: vals.length,
  }))
  return out.sort((a, b) => b.avgScore - a.avgScore)
}

export interface RubricaTagRow { item: string; count: number }

/** KPI-4.2 (Top Strengths, wantPass=true) / KPI-4.3 (Top Areas of
 *  Opportunity, wantPass=false): counts how often each individually-scored
 *  checklist item ('rubrica_pN_nombre') passed or failed, using whichever
 *  numbered items each session's evaluator actually produced. */
export async function rolplayAppRubricaTags(
  clientId: number, wantPass: boolean, range?: { fromIso: string; toIso: string }, solution?: string | null,
): Promise<RubricaTagRow[]> {
  const parsed = await rolplayAppClosingDataRows(clientId, range, solution)
  const counts = new Map<string, number>()
  const re = /^rubrica_p(\d+)_nombre$/
  for (const d of parsed) {
    for (const [k, v] of Object.entries(d)) {
      const m = re.exec(k)
      if (!m || !v) continue
      const cumplido = String(d[`rubrica_p${m[1]}_cumplido`] ?? '').trim().toLowerCase()
      if (cumplido !== 'true' && cumplido !== 'false') continue
      if ((cumplido === 'true') === wantPass) {
        const name = String(v)
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([item, count]) => ({ item, count }))
}

/** KPI-5.1: % of sessions where the evaluator's own 'intencion_movement'
 *  field records a positive shift (Siigo's real values: 'Subió'/'Bajó').
 *  Returns null (not 0) when nothing in scope has this field, so the
 *  widget can report "no data" rather than a fabricated 0%. */
export async function rolplayAppAdoptionMovementRate(
  clientId: number, range?: { fromIso: string; toIso: string }, solution?: string | null,
): Promise<number | null> {
  const parsed = await rolplayAppClosingDataRows(clientId, range, solution)
  const movements = parsed.map(d => String(d.intencion_movement ?? '').trim()).filter(Boolean)
  if (!movements.length) return null
  const positive = movements.filter(m => /^(sub|up|increas|avanz)/i.test(m)).length
  return Math.round((100 * positive / movements.length) * 10) / 10
}
