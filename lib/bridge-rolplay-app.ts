/**
 * bridge-rolplay-app.ts
 *
 * Data adapter for clients on the standalone Rolplay app platform (the r_*
 * tables in rolplay.app), reached ONLY through the read-only raw-SQL endpoint
 * ROLPLAY_APP_SQL_URL (SELECT-only, enforced server-side).
 *
 * COUNTS-ONLY, on purpose: on this platform r_user_session.score is essentially
 * never populated (e.g. Siigo: 0 of 89 sessions have a score). So this adapter
 * reports real session/user counts and dates, and leaves avgScore/passRate
 * honestly null — it never invents a score. Per-turn transcripts live in
 * r_user_session_details (not surfaced here yet).
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
  // Built-in demo login for Siigo (client_id 29). Extend via env without a deploy.
  const map = new Map<string, number>([['demo@siigo.com', 29]])
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

// ── Adapters ─────────────────────────────────────────────────────────────────

const EMPTY_OVERVIEW: OverviewApiResponse = {
  totalEvaluations: 0, prevTotalEvaluations: 0,
  avgScore: null, prevAvgScore: null,
  passRate: null, prevPassRate: null,
  passedEvaluations: 0,
}

/** Overview = real session count for the client. Scores are honestly null. */
export async function rolplayAppOverview(clientId: number): Promise<OverviewApiResponse> {
  const cid = Math.trunc(clientId)
  const rows = await remoteSelect<{ sessions: number | string }>(
    `SELECT COUNT(s.ID) AS sessions
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}`,
  ).catch(() => [])
  const sessions = Number(rows[0]?.sessions ?? 0)
  return { ...EMPTY_OVERVIEW, totalEvaluations: sessions }
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

/** Recent sessions as rows — real id/simulator/date; score/result null (not captured). */
export async function rolplayAppResults(clientId: number, limit: number): Promise<ResultsApiResponse> {
  const cid = Math.trunc(clientId)
  const lim = Math.max(1, Math.min(200, Math.trunc(limit)))
  const rows = await remoteSelect<{
    id: number | string
    simulator_id: number | string | null
    date_created: string
  }>(
    `SELECT s.ID AS id, s.simulator_id, s.date_created
       FROM r_user_session s JOIN r_user u ON u.ID = s.user_id
      WHERE u.client_id = ${cid}
      ORDER BY s.date_created DESC
      LIMIT ${lim}`,
  ).catch(() => [])

  const data: EvaluationApiRow[] = rows.map((r) => ({
    savedReportId: Number(r.id),
    usecaseId: r.simulator_id != null ? Number(r.simulator_id) : null,
    score: null,          // not captured on this platform
    result: null,
    passed: false,
    date: String(r.date_created).slice(0, 10),
  }))
  return { data }
}
