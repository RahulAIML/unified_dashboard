/**
 * bridge-pharma-analytics.ts
 *
 * Data adapter for pharma-sim tenants (Sanfer, Apotex, Weser, Adium, …)
 * living on serv.aux-rolplay.com — a completely separate infrastructure
 * from the standard coach_app/rolplay_pro_analytics pipeline and from
 * Banco. See lib/pharma-tenant.ts for tenant resolution + verified module
 * config.
 *
 * SOLUTION-AWARE: the dashboard's module filter ('lms' | 'coach' |
 * 'simulator' | 'certification' | 'second-brain' | null for "Todos") must
 * pull genuinely DIFFERENT data per module, not the same numbers reshuffled:
 *   - Sanfer 'certification' → official platform DB (profiles_assigned /
 *     fase1-3), a WHOLLY SEPARATE data source from session counts.
 *   - Apotex 'coach' → activity_ids 8/9/10 only (Coach Maestro), verified
 *     against kpi.activity_summary; 'simulator' excludes those same ids for
 *     Overview/Breakdown (Trends/BestPerformers/Results fall back to the
 *     unfiltered blend for those three views — the underlying bridge only
 *     supports a single activity_id filter per call, and per-id-merging
 *     every non-coach activity there would mean ~9 extra calls per view).
 *   - 'lms' / 'second-brain' → no verified real data source for ANY pharma
 *     tenant yet, so these return empty rather than repeating other module
 *     data.
 *   - null / 'simulator' (sale_exercises tenants with no coach split) / any
 *     other value → the tenant's general blended view (existing behavior).
 *
 * ISOLATION RULES (mirrors bridge-banco-analytics.ts):
 *   ✅ Only talks to each tenant's bridge over HTTPS — never touches MySQL
 *      directly, never imports from bridge-client.ts or data-provider.ts
 *   ❌ Never references customer_id — pharma tenants are resolved by email
 *      domain only (see pharma-tenant.ts)
 */

import type {
  OverviewApiResponse,
  TrendsApiResponse,
  ApiTrendPoint,
  ScoreDistributionBucket,
  UsecaseBreakdownApiResponse,
  UsecaseApiRow,
  BestPerformersApiResponse,
  BestPerformerRow,
  ResultsApiResponse,
  EvaluationApiRow,
  ObjectionsApiResponse,
  ObjectionRow,
  BusinessLinesApiResponse,
  BusinessLineRow,
  OrganizationApiResponse,
  OrgMemberRow,
  OrgAdminRow,
} from './types'
import type { DrilldownResult, DrilldownField } from './data-provider'
import { TENANT_CONFIG, type PharmaTenant } from './pharma-tenant'

const PASS_THRESHOLD = 70 // matches every tenant's own pass/fail convention (>=70)

const EMPTY_OVERVIEW: OverviewApiResponse = {
  totalEvaluations: 0, prevTotalEvaluations: 0,
  avgScore: null,      prevAvgScore: null,
  passRate: null,      prevPassRate: null,
  passedEvaluations: 0,
}
const EMPTY_TRENDS: TrendsApiResponse = { scoreTrend: [], passFailTrend: [], evalCountTrend: [] }

// ── HTTP client ────────────────────────────────────────────────────────────────

async function bridgeCall<T = Record<string, unknown>>(
  tenant: PharmaTenant,
  action: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const cfg = TENANT_CONFIG[tenant]
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.xTenant) headers['X-Tenant'] = cfg.xTenant

  const res = await fetch(cfg.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || json.ok === false) {
    throw new Error(`pharma bridge [${tenant}/${action}] failed: ${json?.error ?? res.status}`)
  }
  return json as T
}

/** ISO-8601 → 'YYYY-MM-DD' (every bridge's date filter expects plain dates) */
function isoToDate(iso: string): string {
  return iso.slice(0, 10)
}

// ── sale_exercises tenants: raw-row fetch + in-adapter aggregation ─────────────

interface SaleExercisesRow {
  id: number
  usecase_id: number
  usecase_name: string
  email: string
  name: string
  date: string
  score: number
}

// sim.demorp6's row shape (Weser, Adium) — PascalCase Spanish keys.
interface SimDemorp6Row {
  ID_Sim: number
  ID_Caso_de_Uso: number
  Usuario: string
  Usuario_Nombre: string
  Fecha_y_Hora: string
  Calificacion: number
}

// Overview, trends, breakdown, results and best-performers each independently
// call fetchSaleExercisesSessions for the same (tenant, range) on one page
// load — for a tenant with years of history (Sanfer: ~9k rows / tens of MB)
// that's several concurrent full re-fetches of the identical dataset from the
// upstream bridge, and under that load one of them can time out even though
// the others succeed (looks like a random per-widget failure, not a data bug).
// Coalesce concurrent/near-concurrent calls for the same key into one fetch.
const _sessionsCache = new Map<string, { promise: Promise<SaleExercisesRow[]>; expiresAt: number }>()
const SESSIONS_CACHE_TTL_MS = 30_000

async function fetchSaleExercisesSessions(
  tenant: PharmaTenant,
  fromIso: string,
  toIso: string,
): Promise<SaleExercisesRow[]> {
  const key = `${tenant}|${fromIso}|${toIso}`
  const now = Date.now()
  const hit = _sessionsCache.get(key)
  if (hit && hit.expiresAt > now) return hit.promise

  const promise = fetchSaleExercisesSessionsUncached(tenant, fromIso, toIso)
  _sessionsCache.set(key, { promise, expiresAt: now + SESSIONS_CACHE_TTL_MS })
  promise.catch(() => _sessionsCache.delete(key)) // never cache a failure
  return promise
}

async function fetchSaleExercisesSessionsUncached(
  tenant: PharmaTenant,
  fromIso: string,
  toIso: string,
): Promise<SaleExercisesRow[]> {
  if (TENANT_CONFIG[tenant].kind === 'exceltis_rest') {
    return fetchExceltisRestSessions(tenant, fromIso, toIso)
  }

  const cfg = TENANT_CONFIG[tenant]
  const date_from = isoToDate(fromIso)
  const date_to   = isoToDate(toIso)

  if (tenant === 'sanfer') {
    // Sanfer's real dashboard (src/api/client.ts) always scopes to its exact
    // 44-ID certification exercise list via sim.demorp6 — using the broader
    // "every usecase for this client" scan silently returns a DIFFERENT
    // (larger) total than the real product.
    const [sessionsResp, namesResp] = await Promise.all([
      bridgeCall<{ data: SimDemorp6Row[] }>(tenant, 'sim.demorp6', {
        ids: cfg.ucids!.join(','), date_from, date_to, refresh: 1,
      }),
      bridgeCall<{ data: { ID_Caso_de_Uso: number; Caso_de_Uso: string }[] }>(tenant, 'activities.demorp6', {
        ids: cfg.ucids!.join(','),
      }).catch(() => ({ data: [] })),
    ])
    const nameById = new Map(namesResp.data.map(a => [a.ID_Caso_de_Uso, a.Caso_de_Uso]))
    return (sessionsResp.data ?? []).map(r => ({
      id: r.ID_Sim, usecase_id: r.ID_Caso_de_Uso,
      usecase_name: nameById.get(r.ID_Caso_de_Uso) ?? '',
      email: r.Usuario, name: r.Usuario_Nombre, date: r.Fecha_y_Hora, score: r.Calificacion,
    }))
  }

  // Weser / Adium — small fixed ucid list, sim.demorp6 requires explicit ids.
  const [sessionsResp, namesResp] = await Promise.all([
    bridgeCall<{ data: SimDemorp6Row[] }>(tenant, 'sim.demorp6', {
      ids: cfg.ucids!.join(','), date_from, date_to,
    }),
    bridgeCall<{ data: { ID_Caso_de_Uso: number; Caso_de_Uso: string }[] }>(tenant, 'activities.demorp6', {
      ids: cfg.ucids!.join(','),
    }).catch(() => ({ data: [] })),
  ])
  const nameById = new Map(namesResp.data.map(a => [a.ID_Caso_de_Uso, a.Caso_de_Uso]))

  return (sessionsResp.data ?? []).map(r => ({
    id:           r.ID_Sim,
    usecase_id:   r.ID_Caso_de_Uso,
    usecase_name: nameById.get(r.ID_Caso_de_Uso) ?? '',
    email:        r.Usuario,
    name:         r.Usuario_Nombre,
    date:         r.Fecha_y_Hora,
    score:        r.Calificacion,
  }))
}

// ── exceltis_rest tenants: existing Flask REST endpoints (GET, not action-dispatch) ──
// Verified against real app.py for Heineken/M8/Lacoste/Lacoste Asistentes/
// Chiesi/Labomed — /api/rol_play_sim_extractor takes REPEATED `id=` params
// (not a comma-separated `ids=`) and `fecha_inicio`/`fecha_fin` (not
// `date_from`/`date_to`). Calificacion can be the literal string "No aplica"
// when no score has been recorded for a session yet — those rows are
// excluded from KPI aggregation (nothing to score), not counted as a zero.

interface ExceltisRestRow {
  ID_Sim: number | string
  ID_Caso_de_Uso: number | string
  Usuario: string
  Usuario_Nombre: string
  Fecha_y_Hora: string
  Calificacion: number | string
  [extraField: string]: unknown // Pregunta_N/Respuesta_N/etc — client-specific, used only by drilldown
}

function buildIdQuery(ucids: number[]): string {
  return ucids.map(id => `id=${id}`).join('&')
}

async function exceltisRestCall<T>(baseUrl: string, path: string, query: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}?${query}`, {
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || (json && typeof json === 'object' && 'error' in json)) {
    throw new Error(`exceltis_rest [${baseUrl}${path}] failed: ${(json as { error?: string })?.error ?? res.status}`)
  }
  return json as T
}

/** Raw rows (untyped extra fields preserved) — used by both the aggregate path and drilldown. */
async function fetchExceltisRestRawRows(
  tenant: PharmaTenant, fromIso: string, toIso: string,
): Promise<ExceltisRestRow[]> {
  const cfg = TENANT_CONFIG[tenant]
  const idQuery = buildIdQuery(cfg.ucids!)
  const fecha_inicio = isoToDate(fromIso)
  const fecha_fin = isoToDate(toIso)
  const rows = await exceltisRestCall<ExceltisRestRow[]>(
    cfg.url, '/api/rol_play_sim_extractor', `${idQuery}&fecha_inicio=${fecha_inicio}&fecha_fin=${fecha_fin}`,
  )
  return Array.isArray(rows) ? rows : []
}

async function fetchExceltisRestActivityNames(tenant: PharmaTenant): Promise<Map<number, string>> {
  const cfg = TENANT_CONFIG[tenant]
  try {
    const resp = await exceltisRestCall<{ data: { ID_Caso_de_Uso: number | string; Caso_de_Uso: string }[] }>(
      cfg.url, '/api/dim_actividades', buildIdQuery(cfg.ucids!),
    )
    return new Map((resp.data ?? []).map(a => [Number(a.ID_Caso_de_Uso), a.Caso_de_Uso]))
  } catch {
    return new Map()
  }
}

async function fetchExceltisRestSessions(
  tenant: PharmaTenant, fromIso: string, toIso: string,
): Promise<SaleExercisesRow[]> {
  const [rawRows, nameById] = await Promise.all([
    fetchExceltisRestRawRows(tenant, fromIso, toIso),
    fetchExceltisRestActivityNames(tenant),
  ])
  return rawRows
    .map(r => {
      const score = Number(r.Calificacion)
      if (Number.isNaN(score)) return null // "No aplica" — session exists but has no score yet
      const usecaseId = Number(r.ID_Caso_de_Uso)
      return {
        id: Number(r.ID_Sim),
        usecase_id: usecaseId,
        usecase_name: nameById.get(usecaseId) ?? '',
        email: r.Usuario,
        name: r.Usuario_Nombre,
        date: r.Fecha_y_Hora,
        score,
      }
    })
    .filter((r): r is SaleExercisesRow => r !== null)
}

function aggregateSaleExercisesRows(rows: SaleExercisesRow[]) {
  const total  = rows.length
  const passed = rows.filter(r => r.score >= PASS_THRESHOLD).length
  const avg    = total ? rows.reduce((s, r) => s + r.score, 0) / total : null
  return {
    total,
    avgScore: avg != null ? Math.round(avg * 100) / 100 : null,
    passRate: total ? Math.round((passed / total) * 10000) / 100 : null,
    passed,
  }
}

// ── Data bounds (earliest/latest session date) — snap-to-span default range ──
// A fresh login must show a tenant's full history, not a trailing window. Each
// bridge kind exposes its span differently, so derive it from data that already
// exists (no bridge changes — the bridge is a read-only production dependency).

function endOfMonthIso(period: string): string {
  // 'YYYY-MM' → last calendar day of that month as 'YYYY-MM-DD'
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return `${period}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${period}-${String(lastDay).padStart(2, '0')}`
}

export async function pharmaDataBounds(
  tenant: PharmaTenant,
): Promise<{ min: string; max: string } | null> {
  const cfg = TENANT_CONFIG[tenant]

  if (cfg.kind === 'kpi') {
    // Monthly trend over a wide window is the cheapest way to learn the span
    // without pulling every session row.
    const resp = await bridgeCall<{ trend: ApotexTrendRow[] }>(tenant, 'kpi.score_trend', {
      date_from: '2015-01-01', date_to: '2035-12-31', granularity: 'month',
    }).catch(() => ({ trend: [] as ApotexTrendRow[] }))
    const periods = (resp.trend ?? [])
      .filter(r => Number(r.sessions) > 0)
      .map(r => r.period)
      .filter(Boolean)
      .sort()
    if (!periods.length) return null
    return { min: `${periods[0]}-01`, max: endOfMonthIso(periods[periods.length - 1]) }
  }

  // sale_exercises / exceltis_rest — derive from the actual session rows.
  const rows = await fetchSaleExercisesSessions(
    tenant, '2015-01-01T00:00:00.000Z', '2035-12-31T00:00:00.000Z',
  ).catch(() => [] as SaleExercisesRow[])
  const dates = rows.map(r => String(r.date).slice(0, 10)).filter(Boolean).sort()
  if (!dates.length) return null
  return { min: dates[0], max: dates[dates.length - 1] }
}

// ── Sanfer certification: WHOLLY SEPARATE data source (official platform DB) ──
// Verified against src/pages/CertificationPage.tsx + src/api/client.ts:
// fetchCertStats() / fetchCertification() query profiles_assigned on the
// official DB (rolePlay_sanfer_v3), NOT sale_exercises. No date-range concept
// exists here — cert.stats/org.certification are current-state snapshots.

interface SanferCertStats {
  total: number; certified: number; completed: number; expected: number
  pct: number; cert_pct: number
}
interface SanferCertRow {
  mb_user: string; nombre: string | null; profile_id: number
  // Real sales-line name for this profile_id, from queries_Sanfer.pdf's
  // "Users certified by line" query (LEFT JOIN sales_line ON bhl_id =
  // prf_assigned_profile) — added to the bridge query for this; without it
  // there is no way to name a profile_id group other than the raw number.
  linea: string | null
  finalized: 0 | 1
  // fase*_score come back from PDO as numeric strings ("95.00"), not numbers —
  // same class of bug as Apotex's sessions_pass. Number() before any arithmetic,
  // or reduce() silently does string concatenation and the result serializes
  // as NaN -> null in JSON, masking the bug entirely.
  fase1: 0 | 1; fase1_score: number | string | null
  fase2: 0 | 1; fase2_score: number | string | null
  fase3: 0 | 1; fase3_score: number | string | null
}

function faseScores(r: SanferCertRow): number[] {
  return [r.fase1_score, r.fase2_score, r.fase3_score]
    .filter((n): n is number | string => n != null)
    .map(Number)
    .filter(n => !Number.isNaN(n))
}
function fasesCompleted(r: SanferCertRow): number {
  return r.fase1 + r.fase2 + r.fase3
}

async function sanferCertificationOverview(): Promise<OverviewApiResponse> {
  const [stats, rows] = await Promise.all([
    bridgeCall<{ total: number } & SanferCertStats>('sanfer', 'cert.stats', { refresh: 1 }),
    bridgeCall<{ data: SanferCertRow[] }>('sanfer', 'org.certification', { refresh: 1 }),
  ])
  const allScores = (rows.data ?? []).flatMap(faseScores)
  const avgScore  = allScores.length ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100 : null
  return {
    totalEvaluations: stats.total, avgScore, passRate: stats.cert_pct, passedEvaluations: stats.certified,
    // cert.stats is a current-state snapshot with no date range — there is no
    // real "previous period" to compare against, so we report zero change
    // rather than fabricate a trend that doesn't exist.
    prevTotalEvaluations: stats.total, prevAvgScore: avgScore, prevPassRate: stats.cert_pct,
  }
}

async function sanferCertificationBreakdown(): Promise<UsecaseBreakdownApiResponse> {
  const resp = await bridgeCall<{ data: SanferCertRow[] }>('sanfer', 'org.certification', { refresh: 1 })
  const byProfile = new Map<number, { name: string | null; total: number; passed: number; scores: number[] }>()
  for (const r of resp.data ?? []) {
    const b = byProfile.get(r.profile_id) ?? { name: r.linea, total: 0, passed: 0, scores: [] }
    b.total++
    if (r.finalized) b.passed++
    b.scores.push(...faseScores(r))
    byProfile.set(r.profile_id, b)
  }
  const data: UsecaseApiRow[] = [...byProfile.entries()]
    .map(([profileId, b]) => ({
      usecaseId: profileId,
      usecase_name: b.name,
      totalEvaluations: b.total,
      avgScore: b.scores.length ? Math.round((b.scores.reduce((a, c) => a + c, 0) / b.scores.length) * 100) / 100 : null,
      passRate: b.total ? Math.round((b.passed / b.total) * 10000) / 100 : null,
      passed: b.passed,
    }))
    .sort((a, b) => b.totalEvaluations - a.totalEvaluations)
  return { data }
}

async function sanferCertificationBestPerformers(limit: number): Promise<BestPerformersApiResponse> {
  const resp = await bridgeCall<{ data: SanferCertRow[] }>('sanfer', 'org.certification', { refresh: 1 })
  const data: BestPerformerRow[] = (resp.data ?? [])
    .map(r => {
      const scores = faseScores(r)
      return {
        user_email: r.mb_user, user_name: r.nombre,
        sessions: fasesCompleted(r),
        avg_score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0,
        pass_rate: r.finalized ? 100 : Math.round((fasesCompleted(r) / 3) * 10000) / 100,
      }
    })
    .sort((a, b) => b.avg_score - a.avg_score || b.sessions - a.sessions)
    .slice(0, limit)
  return { data }
}

async function sanferCertificationResults(limit: number): Promise<ResultsApiResponse> {
  const resp = await bridgeCall<{ data: SanferCertRow[] }>('sanfer', 'org.certification', { refresh: 1 })
  // No numeric session ID exists in this dataset (profiles_assigned rows are
  // per-user, not per-event) — synthesize a stable one from array position so
  // rows render, but drilldown is not meaningful for certification rows.
  const data: EvaluationApiRow[] = (resp.data ?? [])
    .slice(0, limit)
    .map((r, i) => {
      const scores = faseScores(r)
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      return {
        savedReportId: -(i + 1), // negative = certification-sourced, not a real bridge session id
        usecaseId: r.profile_id,
        usecaseName: null, // profiles_assigned has no name source for profile_id
        score: Math.round(avg),
        result: r.finalized ? 'passed' : 'failed',
        passed: r.finalized === 1,
        date: '', // profiles_assigned carries no per-row date
      }
    })
  return { data }
}

// ── Apotex: purpose-built kpi.* actions ────────────────────────────────────────

// NOTE: fields commented "PDO string" come back as numeric strings, not
// numbers — MySQL SUM(expr) is returned as a DECIMAL string by the mysqlnd
// driver unless explicitly CAST. Always Number() these before use.
interface ApotexOverview {
  overview: {
    total_sessions: number
    avg_score: number | null
    pass_rate_pct: number
    sessions_pass: number | string // PDO string
  }
}

interface ApotexTrendRow {
  period: string
  sessions: number
  avg_score: number | null
  sessions_pass: number | string // PDO string
}

interface ApotexActivityRow {
  activity_id: number
  activity_name: string | null
  activity_type: string | null // e.g. "Coach maestro", "Coach evaluador", "Visita Médica APECS" — the real module tag
  sessions: number
  avg_score: number | null
  pass_rate_pct: number
  sessions_pass: number | string // PDO string
}

interface ApotexLeaderRow {
  name: string | null
  email: string
  sessions: number
  avg_score: number | null
  pass_rate_pct: number
}

interface ApotexSessionRow {
  id: number
  fecha: string
  usecase_id: number | null
  activity_id: number
  score: number
}

/** kpi.activity_summary rows split into Coach Maestro vs everything else.
 *
 * The bridge tags each activity with a real activity_type ("Coach maestro",
 * "Coach evaluador", "Visita Médica APECS", ...) — verified live. We split on
 * that field so a NEW Coach-maestro activity added later is picked up
 * automatically, instead of relying on a hardcoded id list that silently goes
 * stale (which would drop the new activity into "Simulator" by mistake). The
 * configured coachActivityIds remain a fallback only for the (older) case
 * where a row has no activity_type at all. */
async function apotexActivityGroups(fromIso: string, toIso: string) {
  const resp = await bridgeCall<{ activities: ApotexActivityRow[] }>('apotex', 'kpi.activity_summary', {
    date_from: isoToDate(fromIso), date_to: isoToDate(toIso),
  })
  const coachIdFallback = new Set(TENANT_CONFIG.apotex.coachActivityIds ?? [])
  const isCoach = (a: ApotexActivityRow) =>
    a.activity_type
      ? a.activity_type.trim().toLowerCase() === 'coach maestro'
      : coachIdFallback.has(a.activity_id)
  const all = (resp.activities ?? []).filter(a => Number(a.sessions) > 0)
  return {
    coach: all.filter(isCoach),
    simulator: all.filter(a => !isCoach(a)),
  }
}

function summarizeApotexActivities(rows: ApotexActivityRow[]): OverviewApiResponse {
  const total  = rows.reduce((s, r) => s + Number(r.sessions), 0)
  const passed = rows.reduce((s, r) => s + Number(r.sessions_pass), 0)
  const scoreWeighted = rows.reduce((s, r) => s + (r.avg_score ?? 0) * Number(r.sessions), 0)
  return {
    totalEvaluations: total,
    avgScore: total ? Math.round((scoreWeighted / total) * 100) / 100 : null,
    passRate: total ? Math.round((passed / total) * 10000) / 100 : null,
    passedEvaluations: passed,
    prevTotalEvaluations: 0, prevAvgScore: null, prevPassRate: null, // filled in by caller with a second window
  }
}

function activityRowsToUsecaseRows(rows: ApotexActivityRow[]): UsecaseApiRow[] {
  return rows
    .map(a => ({
      usecaseId: a.activity_id, usecase_name: a.activity_name,
      totalEvaluations: Number(a.sessions),
      avgScore: a.avg_score != null ? Number(a.avg_score) : null,
      passRate: a.pass_rate_pct != null ? Number(a.pass_rate_pct) : null,
      passed: Number(a.sessions_pass),
    }))
    .sort((a, b) => b.totalEvaluations - a.totalEvaluations)
}

/** Coach Maestro trends/leaderboard/sessions — merges per-id calls (only 3 ids, cheap). */
async function apotexActivityTrend(ids: number[], fromIso: string, toIso: string): Promise<TrendsApiResponse> {
  const resps = await Promise.all(ids.map(id =>
    bridgeCall<{ trend: ApotexTrendRow[] }>('apotex', 'kpi.score_trend', {
      date_from: isoToDate(fromIso), date_to: isoToDate(toIso), granularity: 'day', activity_id: id,
    }).catch(() => ({ trend: [] as ApotexTrendRow[] }))
  ))
  const byDay = new Map<string, { sessions: number; pass: number; scoreWeighted: number }>()
  for (const resp of resps) {
    for (const r of resp.trend ?? []) {
      const sessions = Number(r.sessions), pass = Number(r.sessions_pass)
      const b = byDay.get(r.period) ?? { sessions: 0, pass: 0, scoreWeighted: 0 }
      b.sessions += sessions; b.pass += pass; b.scoreWeighted += (r.avg_score ?? 0) * sessions
      byDay.set(r.period, b)
    }
  }
  const days = [...byDay.keys()].sort()
  const scoreTrend: ApiTrendPoint[] = [], passFailTrend: ApiTrendPoint[] = [], evalCountTrend: ApiTrendPoint[] = []
  for (const day of days) {
    const b = byDay.get(day)!
    scoreTrend.push({ date: day, value: b.sessions ? Math.round((b.scoreWeighted / b.sessions) * 100) / 100 : 0 })
    passFailTrend.push({ date: day, value: b.pass, value2: b.sessions - b.pass })
    evalCountTrend.push({ date: day, value: b.sessions })
  }
  return { scoreTrend, passFailTrend, evalCountTrend }
}

async function apotexActivityLeaderboard(ids: number[], fromIso: string, toIso: string, limit: number): Promise<BestPerformersApiResponse> {
  const resps = await Promise.all(ids.map(id =>
    bridgeCall<{ leaderboard: ApotexLeaderRow[] }>('apotex', 'kpi.leaderboard', {
      date_from: isoToDate(fromIso), date_to: isoToDate(toIso), limit: 500, activity_id: id,
    }).catch(() => ({ leaderboard: [] as ApotexLeaderRow[] }))
  ))
  const byEmail = new Map<string, { name: string | null; sessions: number; scoreWeighted: number; passWeighted: number }>()
  for (const resp of resps) {
    for (const r of resp.leaderboard ?? []) {
      const sessions = Number(r.sessions)
      const b = byEmail.get(r.email) ?? { name: r.name, sessions: 0, scoreWeighted: 0, passWeighted: 0 }
      b.sessions += sessions
      b.scoreWeighted += (r.avg_score ?? 0) * sessions
      b.passWeighted += (r.pass_rate_pct ?? 0) * sessions // weighted across merged activity_ids, same pattern as avg_score
      byEmail.set(r.email, b)
    }
  }
  const data: BestPerformerRow[] = [...byEmail.entries()]
    .map(([email, b]) => ({
      user_email: email, user_name: b.name,
      sessions: b.sessions, avg_score: b.sessions ? Math.round((b.scoreWeighted / b.sessions) * 100) / 100 : 0,
      pass_rate: b.sessions ? Math.round((b.passWeighted / b.sessions) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.avg_score - a.avg_score || b.sessions - a.sessions)
    .slice(0, limit)
  return { data }
}

async function apotexCoachSessions(fromIso: string, toIso: string, limit: number): Promise<ResultsApiResponse> {
  const ids = TENANT_CONFIG.apotex.coachActivityIds ?? []
  const [resps, { coach, simulator }] = await Promise.all([
    Promise.all(ids.map(id =>
      bridgeCall<{ sessions: ApotexSessionRow[] }>('apotex', 'kpi.sessions', {
        date_from: isoToDate(fromIso), date_to: isoToDate(toIso), limit, activity_id: id,
      }).catch(() => ({ sessions: [] as ApotexSessionRow[] }))
    )),
    apotexActivityGroups(fromIso, toIso).catch(() => ({ coach: [], simulator: [] })),
  ])
  const nameById = new Map([...coach, ...simulator].map(a => [a.activity_id, a.activity_name]))
  const rows = resps.flatMap(r => r.sessions ?? [])
  const data: EvaluationApiRow[] = rows
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .slice(0, limit)
    .map(r => {
      const score = Number(r.score); const passed = score >= PASS_THRESHOLD
      const usecaseId = Number(r.usecase_id ?? r.activity_id)
      return {
        savedReportId: Number(r.id), usecaseId, usecaseName: nameById.get(usecaseId) ?? null,
        score, result: passed ? 'passed' : 'failed', passed, date: r.fecha.slice(0, 10),
      }
    })
  return { data }
}

// ── Module routing helper ──────────────────────────────────────────────────────

/**
 * True when `solution` names a module this tenant does NOT have real,
 * distinct data for. Returning empty here (rather than falling through to
 * the tenant's default/blended view) matters: a tenant with no Coach Maestro
 * module must not show its Simulador numbers again under a "Coach Maestro"
 * label — that is the exact "same data everywhere" failure this file exists
 * to avoid.
 */
function isUnsupportedModule(tenant: PharmaTenant, solution: string | null | undefined): boolean {
  if (!solution || solution === 'simulator') return false // "Todos" / general view — always the tenant's own default
  if (solution === 'lms' || solution === 'second-brain') return true // no pharma tenant has real data for these — verified via audit
  if (solution === 'certification') return !TENANT_CONFIG[tenant].hasCertification
  // 'coach' is genuinely separate data ONLY for 'kpi'-kind tenants with a
  // confirmed coachActivityIds split (Apotex). For sale_exercises/
  // exceltis_rest tenants there's no distinct Coach Maestro data source —
  // but unlike lms/second-brain, "coaching" is a legitimate DIFFERENT LENS
  // on the same practice-session data (verified against Sanfer's own
  // CoachingPage.tsx, which derives its insights from the same sim rows,
  // not a separate table) — so it falls through to the tenant's normal
  // data below rather than being blocked as unsupported.
  if (solution === 'coach') return TENANT_CONFIG[tenant].kind === 'kpi' && !TENANT_CONFIG[tenant].coachActivityIds
  return false
}

// ── 1. Overview ───────────────────────────────────────────────────────────────

export async function pharmaDashboardOverview(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; prevFromIso: string; prevToIso: string; solution?: string | null },
): Promise<OverviewApiResponse> {
  if (isUnsupportedModule(tenant, params.solution)) return EMPTY_OVERVIEW

  if (tenant === 'sanfer' && params.solution === 'certification') {
    return sanferCertificationOverview()
  }

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    if (params.solution === 'coach' || params.solution === 'simulator') {
      const wantCoach = params.solution === 'coach'
      const [curGroups, prevGroups] = await Promise.all([
        apotexActivityGroups(params.fromIso, params.toIso),
        apotexActivityGroups(params.prevFromIso, params.prevToIso),
      ])
      const cur  = summarizeApotexActivities(wantCoach ? curGroups.coach : curGroups.simulator)
      const prev = summarizeApotexActivities(wantCoach ? prevGroups.coach : prevGroups.simulator)
      return { ...cur, prevTotalEvaluations: prev.totalEvaluations, prevAvgScore: prev.avgScore, prevPassRate: prev.passRate }
    }
    const [cur, prev] = await Promise.all([
      bridgeCall<ApotexOverview>(tenant, 'kpi.overview', {
        date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso),
      }),
      bridgeCall<ApotexOverview>(tenant, 'kpi.overview', {
        date_from: isoToDate(params.prevFromIso), date_to: isoToDate(params.prevToIso),
      }),
    ])
    return {
      totalEvaluations:     Number(cur.overview.total_sessions),
      avgScore:             cur.overview.avg_score != null ? Number(cur.overview.avg_score) : null,
      passRate:             cur.overview.pass_rate_pct != null ? Number(cur.overview.pass_rate_pct) : null,
      passedEvaluations:    Number(cur.overview.sessions_pass),
      prevTotalEvaluations: Number(prev.overview.total_sessions),
      prevAvgScore:         prev.overview.avg_score != null ? Number(prev.overview.avg_score) : null,
      prevPassRate:         prev.overview.pass_rate_pct != null ? Number(prev.overview.pass_rate_pct) : null,
    }
  }

  const [curRows, prevRows] = await Promise.all([
    fetchSaleExercisesSessions(tenant, params.fromIso, params.toIso),
    fetchSaleExercisesSessions(tenant, params.prevFromIso, params.prevToIso),
  ])
  const cur  = aggregateSaleExercisesRows(curRows)
  const prev = aggregateSaleExercisesRows(prevRows)
  return {
    totalEvaluations:     cur.total,
    avgScore:             cur.avgScore,
    passRate:             cur.passRate,
    passedEvaluations:    cur.passed,
    prevTotalEvaluations: prev.total,
    prevAvgScore:         prev.avgScore,
    prevPassRate:         prev.passRate,
  }
}

// ── 2. Trends ─────────────────────────────────────────────────────────────────

export async function pharmaDashboardTrends(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; solution?: string | null },
): Promise<TrendsApiResponse> {
  if (isUnsupportedModule(tenant, params.solution)) return EMPTY_TRENDS
  // Certification has no per-day breakdown (profiles_assigned carries no
  // date column) — an empty trend is honest; a fabricated one would not be.
  if (tenant === 'sanfer' && params.solution === 'certification') return EMPTY_TRENDS

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    if (params.solution === 'coach') {
      return apotexActivityTrend(TENANT_CONFIG.apotex.coachActivityIds ?? [], params.fromIso, params.toIso)
    }
    if (params.solution === 'simulator') {
      const { simulator } = await apotexActivityGroups(params.fromIso, params.toIso)
      return apotexActivityTrend(simulator.map(a => a.activity_id), params.fromIso, params.toIso)
    }
    const resp = await bridgeCall<{ trend: ApotexTrendRow[] }>(tenant, 'kpi.score_trend', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso), granularity: 'day',
    })
    const scoreTrend: ApiTrendPoint[] = []
    const passFailTrend: ApiTrendPoint[] = []
    const evalCountTrend: ApiTrendPoint[] = []
    for (const r of resp.trend ?? []) {
      const sessions     = Number(r.sessions)
      const sessionsPass = Number(r.sessions_pass)
      scoreTrend.push({ date: r.period, value: r.avg_score != null ? Number(r.avg_score) : 0 })
      passFailTrend.push({ date: r.period, value: sessionsPass, value2: sessions - sessionsPass })
      evalCountTrend.push({ date: r.period, value: sessions })
    }
    return { scoreTrend, passFailTrend, evalCountTrend }
  }

  const rows = await fetchSaleExercisesSessions(tenant, params.fromIso, params.toIso)
  const byDay = new Map<string, { total: number; passed: number; scoreSum: number }>()
  for (const r of rows) {
    const day = r.date.slice(0, 10)
    const bucket = byDay.get(day) ?? { total: 0, passed: 0, scoreSum: 0 }
    bucket.total++
    bucket.scoreSum += r.score
    if (r.score >= PASS_THRESHOLD) bucket.passed++
    byDay.set(day, bucket)
  }
  const days = [...byDay.keys()].sort()
  const scoreTrend: ApiTrendPoint[] = []
  const passFailTrend: ApiTrendPoint[] = []
  const evalCountTrend: ApiTrendPoint[] = []
  for (const day of days) {
    const b = byDay.get(day)!
    scoreTrend.push({ date: day, value: Math.round((b.scoreSum / b.total) * 100) / 100 })
    passFailTrend.push({ date: day, value: b.passed, value2: b.total - b.passed })
    evalCountTrend.push({ date: day, value: b.total })
  }
  return { scoreTrend, passFailTrend, evalCountTrend, scoreDistribution: buildScoreDistribution(rows.map(r => r.score)) }
}

function buildScoreDistribution(scores: number[]): ScoreDistributionBucket[] {
  const buckets = [
    { range: '0-9', min: 0, max: 9 }, { range: '10-19', min: 10, max: 19 },
    { range: '20-29', min: 20, max: 29 }, { range: '30-39', min: 30, max: 39 },
    { range: '40-49', min: 40, max: 49 }, { range: '50-59', min: 50, max: 59 },
    { range: '60-69', min: 60, max: 69 }, { range: '70-79', min: 70, max: 79 },
    { range: '80-89', min: 80, max: 89 }, { range: '90-100', min: 90, max: 100 },
  ]
  const total = scores.length
  return buckets.map(b => {
    const count = scores.filter(s => s >= b.min && s <= b.max).length
    return { range: b.range, count, pct: total ? Math.round((count / total) * 10000) / 100 : 0 }
  })
}

// ── 3. Usecase breakdown ──────────────────────────────────────────────────────

export async function pharmaDashboardUsecaseBreakdown(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; solution?: string | null },
): Promise<UsecaseBreakdownApiResponse> {
  if (isUnsupportedModule(tenant, params.solution)) return { data: [] }
  if (tenant === 'sanfer' && params.solution === 'certification') return sanferCertificationBreakdown()

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    if (params.solution === 'coach' || params.solution === 'simulator') {
      const groups = await apotexActivityGroups(params.fromIso, params.toIso)
      return { data: activityRowsToUsecaseRows(params.solution === 'coach' ? groups.coach : groups.simulator) }
    }
    const resp = await bridgeCall<{ activities: ApotexActivityRow[] }>(tenant, 'kpi.activity_summary', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso),
    })
    return { data: activityRowsToUsecaseRows((resp.activities ?? []).filter(a => Number(a.sessions) > 0)) }
  }

  const rows = await fetchSaleExercisesSessions(tenant, params.fromIso, params.toIso)
  const byUc = new Map<number, { name: string; total: number; passed: number; scoreSum: number }>()
  for (const r of rows) {
    const bucket = byUc.get(r.usecase_id) ?? { name: r.usecase_name, total: 0, passed: 0, scoreSum: 0 }
    bucket.total++
    bucket.scoreSum += r.score
    if (r.score >= PASS_THRESHOLD) bucket.passed++
    byUc.set(r.usecase_id, bucket)
  }
  const data: UsecaseApiRow[] = [...byUc.entries()]
    .map(([usecaseId, b]) => ({
      usecaseId,
      usecase_name:     b.name || null,
      totalEvaluations: b.total,
      avgScore:         Math.round((b.scoreSum / b.total) * 100) / 100,
      passRate:         Math.round((b.passed / b.total) * 10000) / 100,
      passed:           b.passed,
    }))
    .sort((a, b) => b.totalEvaluations - a.totalEvaluations)
  return { data }
}

// ── 4. Best performers ────────────────────────────────────────────────────────

export async function pharmaDashboardBestPerformers(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; limit: number; solution?: string | null },
): Promise<BestPerformersApiResponse> {
  const limit = Math.min(Math.max(1, params.limit), 20)
  if (isUnsupportedModule(tenant, params.solution)) return { data: [] }
  if (tenant === 'sanfer' && params.solution === 'certification') return sanferCertificationBestPerformers(limit)

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    if (params.solution === 'coach') {
      return apotexActivityLeaderboard(TENANT_CONFIG.apotex.coachActivityIds ?? [], params.fromIso, params.toIso, limit)
    }
    if (params.solution === 'simulator') {
      const { simulator } = await apotexActivityGroups(params.fromIso, params.toIso)
      return apotexActivityLeaderboard(simulator.map(a => a.activity_id), params.fromIso, params.toIso, limit)
    }
    const resp = await bridgeCall<{ leaderboard: ApotexLeaderRow[] }>(tenant, 'kpi.leaderboard', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso), limit,
    })
    const data: BestPerformerRow[] = (resp.leaderboard ?? []).map(r => ({
      user_email: r.email,
      user_name:  r.name,
      sessions:   Number(r.sessions),
      avg_score:  r.avg_score != null ? Number(r.avg_score) : 0,
      pass_rate:  Number(r.pass_rate_pct),
    }))
    return { data }
  }

  const rows = await fetchSaleExercisesSessions(tenant, params.fromIso, params.toIso)
  const byUser = new Map<string, { name: string; total: number; passed: number; scoreSum: number }>()
  for (const r of rows) {
    if (!r.email) continue
    const bucket = byUser.get(r.email) ?? { name: r.name, total: 0, passed: 0, scoreSum: 0 }
    bucket.total++
    bucket.scoreSum += r.score
    if (r.score >= PASS_THRESHOLD) bucket.passed++
    if (r.name) bucket.name = r.name
    byUser.set(r.email, bucket)
  }
  const data: BestPerformerRow[] = [...byUser.entries()]
    .map(([email, b]) => ({
      user_email: email,
      user_name:  b.name || null,
      sessions:   b.total,
      avg_score:  Math.round((b.scoreSum / b.total) * 100) / 100,
      pass_rate:  Math.round((b.passed / b.total) * 10000) / 100,
    }))
    .sort((a, b) => b.avg_score - a.avg_score || b.sessions - a.sessions)
    .slice(0, limit)

  // sim.topstats — all-time (not date-filtered) aggregate. Only Sanfer's
  // bridge has this action confirmed working; skip silently for everyone else.
  let allTimeStats: BestPerformersApiResponse['allTimeStats']
  if (tenant === 'sanfer') {
    try {
      const ts = await bridgeCall<{
        stats: { total_records: number; avg_best_score: number; records_ge80: number; unique_sims: number; unique_users: number }
      }>('sanfer', 'sim.topstats')
      allTimeStats = {
        totalRecords: Number(ts.stats.total_records),
        avgBestScore: Number(ts.stats.avg_best_score),
        recordsGe80:  Number(ts.stats.records_ge80),
        uniqueUsers:  Number(ts.stats.unique_users),
        uniqueSims:   Number(ts.stats.unique_sims),
      }
    } catch {
      // non-critical — omit if the call fails
    }
  }
  return { data, allTimeStats }
}

// ── 5. Individual results ─────────────────────────────────────────────────────

export async function pharmaDashboardResults(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; limit: number; solution?: string | null },
): Promise<ResultsApiResponse> {
  const limit = Math.min(Math.max(1, params.limit), 200)
  if (isUnsupportedModule(tenant, params.solution)) return { data: [] }
  if (tenant === 'sanfer' && params.solution === 'certification') return sanferCertificationResults(limit)

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    if (params.solution === 'coach') return apotexCoachSessions(params.fromIso, params.toIso, limit)
    const [resp, { coach, simulator }] = await Promise.all([
      bridgeCall<{ sessions: ApotexSessionRow[] }>(tenant, 'kpi.sessions', {
        date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso), limit,
      }),
      apotexActivityGroups(params.fromIso, params.toIso).catch(() => ({ coach: [], simulator: [] })),
    ])
    const nameById = new Map(
      [...coach, ...simulator].map(a => [a.activity_id, a.activity_name]),
    )
    // 'simulator' must exclude Coach Maestro sessions, matching the split
    // Overview/Breakdown already apply — kpi.sessions itself doesn't filter
    // by activity_id here, so filter the already-fetched rows locally instead
    // of the N-extra-calls-per-activity-id cost of re-fetching per id.
    const coachIds = new Set((TENANT_CONFIG.apotex.coachActivityIds ?? []))
    const sessions = params.solution === 'simulator'
      ? (resp.sessions ?? []).filter(r => !coachIds.has(Number(r.usecase_id ?? r.activity_id)))
      : (resp.sessions ?? [])
    const data: EvaluationApiRow[] = sessions.map(r => {
      const score  = Number(r.score)
      const passed = score >= PASS_THRESHOLD
      const usecaseId = Number(r.usecase_id ?? r.activity_id)
      return {
        savedReportId: Number(r.id),
        usecaseId,
        usecaseName:   nameById.get(usecaseId) ?? null,
        score,
        result:        passed ? 'passed' : 'failed',
        passed,
        date:          r.fecha.slice(0, 10),
      }
    })
    return { data }
  }

  const rows = await fetchSaleExercisesSessions(tenant, params.fromIso, params.toIso)
  const data: EvaluationApiRow[] = rows
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map(r => {
      const passed = r.score >= PASS_THRESHOLD
      return {
        savedReportId: r.id,
        usecaseId:     r.usecase_id,
        usecaseName:   r.usecase_name || null,
        score:         r.score,
        result:        passed ? 'passed' : 'failed',
        passed,
        date:          r.date.slice(0, 10),
      }
    })
  return { data }
}

// ── Objections (Sanfer only, confirmed via objections.demorp6) ────────────────

interface SanferObjectionRow {
  usecase_id: number
  objection_text: string
  count: number
  pass_count: number
  pass_rate: number
  model_answer: string
  top_answers: { text: string; name: string }[]
}

export async function pharmaDashboardObjections(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string },
): Promise<ObjectionsApiResponse> {
  const cfg = TENANT_CONFIG[tenant]
  if (!cfg.hasObjections || !cfg.ucids) return { data: [] }
  const resp = await bridgeCall<{ data: SanferObjectionRow[] }>(tenant, 'objections.demorp6', {
    ids: cfg.ucids.join(','), date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso),
  })
  const data: ObjectionRow[] = (resp.data ?? []).map(r => ({
    usecaseId: r.usecase_id,
    objectionText: r.objection_text,
    count: Number(r.count),
    passRate: Number(r.pass_rate),
    modelAnswer: r.model_answer || null,
    topAnswers: r.top_answers ?? [],
  }))
  return { data }
}

// ── Business Lines (Sanfer only, confirmed via CERT_LINES in src/lib/certification.ts) ──
// Copied directly from the real Sanfer_dashboard repo (RahulAIML/sanfer) —
// tagId -> its 3 assigned saexId (usecase_id) values. This is NOT the same
// number space as tag1.id/profile_id — usecase_ids are the 390-493 exercise
// IDs, tag1/profile_id are small 1-32 line identifiers. An earlier version of
// this function wrongly assumed usecase_id === tagId, which produced all
// zeros (no session's usecase_id is ever in the 1-32 range).
const SANFER_CERT_LINE_SAEX_IDS: Record<number, number[]> = {
  6:  [464, 436, 484], // Minotauros
  28: [411, 454, 481], // Proteus
  8:  [489, 460, 468], // Poseidón
  9:  [445, 410, 491], // Horus
  10: [461, 402, 432], // Cíclopes
  11: [453, 419, 403], // Cronos
  12: [465, 405, 446], // Atlantes
  23: [420, 408, 440], // Fenix
  5:  [428, 457, 488], // Argonautas
  7:  [409, 449, 420], // Apolos
  1:  [399, 490, 390], // Titanes
  2:  [493, 413, 448], // Pegasos
  3:  [406, 492, 455], // Perseus
  25: [467, 433, 462], // Ares
  24: [421, 423, 439], // Vulcanos
}

interface Tag1Row { id: number; name: string; idStatus: number }
interface SanferMemberTagRow { mb_idTag1: number }

export async function pharmaDashboardBusinessLines(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string },
): Promise<BusinessLinesApiResponse> {
  const cfg = TENANT_CONFIG[tenant]
  if (!cfg.hasBusinessLines) return { data: [] }

  // tag1 catalog lives behind the api/data/ REST proxy (same convention
  // Sanfer's own fetchLines() uses: src/api/client.ts `${BASE}/data/${CLIENT}/tag1`),
  // NOT the action-dispatch bridge — hardcoded here since only Sanfer has
  // hasBusinessLines set; revisit with a per-tenant DB-name config field if
  // a second tenant needs this.
  const [tagResp, rows, membersResp] = await Promise.all([
    fetch('https://serv.aux-rolplay.com/sanfer/api/data/rolplay_sanfer_robin/tag1', {
      signal: AbortSignal.timeout(30_000), cache: 'no-store',
    }).then(r => r.json()).catch(() => null) as Promise<{ data: Tag1Row[] } | null>,
    fetchSaleExercisesSessions(tenant, params.fromIso, params.toIso),
    bridgeCall<{ data: SanferMemberTagRow[] }>(tenant, 'org.members').catch(() => ({ data: [] })),
  ])
  const lines = (tagResp?.data ?? []).filter(t => SANFER_CERT_LINE_SAEX_IDS[t.id])

  const memberCountByTag = new Map<number, number>()
  for (const m of membersResp.data ?? []) {
    if (!m.mb_idTag1) continue
    memberCountByTag.set(m.mb_idTag1, (memberCountByTag.get(m.mb_idTag1) ?? 0) + 1)
  }

  const byUsecase = new Map<number, { total: number; scoreSum: number; users: Set<string> }>()
  for (const r of rows) {
    const b = byUsecase.get(r.usecase_id) ?? { total: 0, scoreSum: 0, users: new Set() }
    b.total++; b.scoreSum += r.score
    if (r.email) b.users.add(r.email)
    byUsecase.set(r.usecase_id, b)
  }

  const data: BusinessLineRow[] = lines.map(t => {
    const saexIds = SANFER_CERT_LINE_SAEX_IDS[t.id] ?? []
    let total = 0, scoreSum = 0
    const users = new Set<string>()
    for (const id of saexIds) {
      const b = byUsecase.get(id)
      if (!b) continue
      total += b.total; scoreSum += b.scoreSum
      for (const u of b.users) users.add(u)
    }
    return {
      tagId: t.id, name: t.name,
      memberCount: memberCountByTag.get(t.id) ?? 0,
      simCount: total,
      avgScore: total ? Math.round((scoreSum / total) * 100) / 100 : null,
      activeUsers: users.size,
    }
  })
  return { data }
}

// ── Organization (Sanfer only, confirmed via org.members/org.admins) ──────────

interface SanferMemberRow {
  mb_id: number; mb_fullname: string; mb_email: string
  mb_admin: number; mb_designation: string
}
interface SanferAdminRow {
  rpa_id: number; rpa_full_name: string; rpa_email: string; rpa_profile_type: string
}

export async function pharmaDashboardOrganization(tenant: PharmaTenant): Promise<OrganizationApiResponse> {
  const EMPTY: OrganizationApiResponse = { totalMembers: 0, totalAdmins: 0, totalSupervisors: 0, members: [], admins: [] }
  if (!TENANT_CONFIG[tenant].hasOrganization) return EMPTY

  // Same bridge protocol, same row field names (mb_*/rpa_*) — kpi-kind
  // tenants (Apotex) just use different action names and a different
  // top-level response key ("members"/"admins" vs "data"), verified live.
  const isKpi = TENANT_CONFIG[tenant].kind === 'kpi'
  const [membersResp, adminsResp] = await Promise.all([
    isKpi
      ? bridgeCall<{ members: SanferMemberRow[]; count: number }>(tenant, 'list.members').then(r => ({ data: r.members, count: r.count }))
      : bridgeCall<{ data: SanferMemberRow[]; count: number }>(tenant, 'org.members'),
    isKpi
      ? bridgeCall<{ admins: SanferAdminRow[]; count: number }>(tenant, 'list.admins').then(r => ({ data: r.admins, count: r.count }))
      : bridgeCall<{ data: SanferAdminRow[]; count: number }>(tenant, 'org.admins'),
  ])

  const members: OrgMemberRow[] = (membersResp.data ?? []).map(m => ({
    id: m.mb_id, fullName: m.mb_fullname, email: m.mb_email,
    designation: m.mb_designation || null, adminId: m.mb_admin || null,
  }))
  const admins: OrgAdminRow[] = (adminsResp.data ?? []).map(a => ({
    id: a.rpa_id, fullName: a.rpa_full_name, email: a.rpa_email, profileType: a.rpa_profile_type,
  }))
  const totalSupervisors = admins.filter(a => a.profileType === 'supervisor').length
  const totalAdmins = admins.filter(a => a.profileType === 'admin' || a.profileType === 'tenant').length

  return { totalMembers: membersResp.count ?? members.length, totalAdmins, totalSupervisors, members, admins }
}

// ── 6. Drilldown (single session) ─────────────────────────────────────────────

interface SaleExercisesReportRonda {
  n: number
  pregunta: string | null
  respuesta_rep: string | null
  criterio: string
  respuesta_modelo: string
  analisis: string
  puntos: number | null
}
interface SaleExercisesReportSeccion { q: string; a: string }
// sim.report's response shape — identical across Sanfer (PHP), Weser, and
// Adium (both Node) since the Node bridges were ported directly from it.
interface SaleExercisesReport {
  ID_Sim: number
  ID_Caso_de_Uso: number
  Fecha_y_Hora: string
  Calificacion: number
  Producto: string
  Titulo: string
  Rondas: SaleExercisesReportRonda[]
  Secciones: SaleExercisesReportSeccion[]
}

interface ApotexSessionDetail {
  id: number
  fecha: string
  usecase_id: number
  activity_id: number
  actividad: string
  tipo: string
  score: number | string
  feedback: string | null
}

function scoreField(score: number): DrilldownField {
  return {
    fieldKey: 'overall_score', fieldLabel: 'Puntuación',
    valueNum: score, valueText: null, valueLongtext: null, normalizedValue: score,
  }
}
// normalizeResult() in kpi-builder.ts treats the literal string "Deficiente"
// as fail and everything else as pass — match that convention here.
function resultField(passed: boolean): DrilldownField {
  const text = passed ? 'Aprobado' : 'Deficiente'
  return {
    fieldKey: 'overall_result', fieldLabel: 'Resultado',
    valueNum: null, valueText: text, valueLongtext: null, normalizedValue: text,
  }
}
function textField(key: string, label: string, text: string | null): DrilldownField | null {
  if (!text) return null
  return {
    fieldKey: key, fieldLabel: label,
    valueNum: null, valueText: text, valueLongtext: null, normalizedValue: text,
  }
}

// exceltis_rest tenants have no single-session-by-id endpoint (the query is
// scoped by usecase, not saex_id) — fetch across a wide window and find the
// matching row client-side. Fine in practice: every one of these tenants has
// at most a few thousand sessions total.
const CORE_EXCELTIS_KEYS = new Set([
  'ID_Sim', 'ID_Caso_de_Uso', 'Usuario', 'Usuario_Nombre', 'Fecha_y_Hora', 'Calificacion',
])

/**
 * Every extra key on an exceltis_rest row becomes a drilldown field
 * generically — Pregunta_N/Respuesta_N (Gentera/Heineken/Chiesi/Labomed),
 * the 6 competency fields + totals (M8), whatever Lacoste's interaction
 * fields are named, etc. This is what lets one code path serve every
 * client's own bespoke extra fields without hardcoding each one.
 */
function genericFieldsFromExceltisRow(row: ExceltisRestRow): DrilldownField[] {
  const fields: DrilldownField[] = []
  for (const [key, value] of Object.entries(row)) {
    if (CORE_EXCELTIS_KEYS.has(key)) continue
    if (value === null || value === undefined || value === 'No aplica' || value === '') continue
    const label = key.replace(/_/g, ' ')
    if (typeof value === 'number') {
      fields.push({ fieldKey: key.toLowerCase(), fieldLabel: label, valueNum: value, valueText: null, valueLongtext: null, normalizedValue: value })
    } else {
      const text = String(value)
      fields.push({ fieldKey: key.toLowerCase(), fieldLabel: label, valueNum: null, valueText: text, valueLongtext: null, normalizedValue: text })
    }
  }
  return fields
}

export async function pharmaDashboardDrilldown(
  tenant: PharmaTenant,
  savedReportId: number,
): Promise<DrilldownResult | null> {
  // Negative IDs are synthetic (certification rows have no real session id —
  // see sanferCertificationResults). Nothing meaningful to drill into.
  if (savedReportId < 0) return null

  if (TENANT_CONFIG[tenant].kind === 'exceltis_rest') {
    let rawRows: ExceltisRestRow[]
    try {
      rawRows = await fetchExceltisRestRawRows(tenant, '2015-01-01T00:00:00.000Z', '2035-12-31T00:00:00.000Z')
    } catch {
      return null
    }
    const row = rawRows.find(r => Number(r.ID_Sim) === savedReportId)
    if (!row) return null

    const score = Number(row.Calificacion)
    const fields: DrilldownField[] = [
      scoreField(Number.isNaN(score) ? 0 : score),
      resultField(!Number.isNaN(score) && score >= PASS_THRESHOLD),
      ...genericFieldsFromExceltisRow(row),
    ]
    return {
      savedReportId: Number(row.ID_Sim),
      usecaseId: Number(row.ID_Caso_de_Uso),
      date: String(row.Fecha_y_Hora).slice(0, 10),
      fields,
      closingJson: null,
    }
  }

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    let resp: { session: ApotexSessionDetail }
    try {
      resp = await bridgeCall<{ session: ApotexSessionDetail }>(tenant, 'kpi.session_detail', {
        id: savedReportId,
      })
    } catch {
      return null
    }
    const s = resp.session
    const score = Number(s.score)
    const passed = score >= PASS_THRESHOLD
    const fields: DrilldownField[] = [
      scoreField(score),
      resultField(passed),
      textField('actividad', 'Actividad', s.actividad),
      textField('tipo', 'Tipo', s.tipo),
      textField('feedback', 'Retroalimentación', s.feedback),
    ].filter((f): f is DrilldownField => f !== null)

    return {
      savedReportId: s.id,
      usecaseId:     s.usecase_id ?? s.activity_id,
      date:          s.fecha.slice(0, 10),
      fields,
      closingJson:   null,
    }
  }

  let resp: { data: SaleExercisesReport }
  try {
    resp = await bridgeCall<{ data: SaleExercisesReport }>(tenant, 'sim.report', { sim_id: savedReportId })
  } catch {
    return null
  }
  const r = resp.data
  const passed = r.Calificacion >= PASS_THRESHOLD
  const fields: DrilldownField[] = [
    scoreField(r.Calificacion),
    resultField(passed),
    textField('producto', 'Producto', r.Producto),
    textField('titulo', 'Título', r.Titulo),
  ].filter((f): f is DrilldownField => f !== null)

  for (const ronda of r.Rondas ?? []) {
    const n = ronda.n
    fields.push(
      ...([
        textField(`ronda_${n}_pregunta`, `Ronda ${n} — Pregunta`, ronda.pregunta),
        textField(`ronda_${n}_respuesta`, `Ronda ${n} — Respuesta`, ronda.respuesta_rep),
        textField(`ronda_${n}_criterio`, `Ronda ${n} — Criterio`, ronda.criterio),
        textField(`ronda_${n}_modelo`, `Ronda ${n} — Respuesta modelo`, ronda.respuesta_modelo),
        textField(`ronda_${n}_analisis`, `Ronda ${n} — Análisis`, ronda.analisis),
      ].filter((f): f is DrilldownField => f !== null))
    )
  }
  for (const [i, sec] of (r.Secciones ?? []).entries()) {
    fields.push(
      ...([
        textField(`seccion_${i + 1}_q`, `Sección ${i + 1} — Pregunta`, sec.q),
        textField(`seccion_${i + 1}_a`, `Sección ${i + 1} — Respuesta`, sec.a),
      ].filter((f): f is DrilldownField => f !== null))
    )
  }

  return {
    savedReportId: r.ID_Sim,
    usecaseId:     r.ID_Caso_de_Uso,
    date:          r.Fecha_y_Hora.slice(0, 10),
    fields,
    closingJson:   null,
  }
}
