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

import type { OverviewApiResponse, ResultsApiResponse, EvaluationApiRow } from './types'

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

/** Synchronous, no network — safe to call in the org-type hot path. */
export function resolveRolplayAppClientId(email: string): number | null {
  return loginMap().get(email.toLowerCase().trim()) ?? null
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
