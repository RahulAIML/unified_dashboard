/**
 * bridge-pharma-analytics.ts
 *
 * Data adapter for pharma-sim tenants (Sanfer, Apotex, Weser, Adium, …)
 * living on serv.aux-rolplay.com — a completely separate infrastructure
 * from the standard coach_app/rolplay_pro_analytics pipeline and from
 * Banco. See lib/pharma-tenant.ts for tenant resolution + config.
 *
 * Two bridge kinds (TENANT_CONFIG[tenant].kind):
 *   'sale_exercises' — Sanfer, Weser, Adium. Raw per-session rows from a
 *      sale_exercises/usecases-shaped schema, aggregated here in JS. Sanfer
 *      pulls via cert.sessions (no ucid list needed); Weser/Adium pull via
 *      sim.demorp6 with their small fixed ucid list, since their bridges
 *      don't expose an unfiltered variant.
 *   'kpi' — Apotex. Purpose-built kpi.* aggregate actions, mapped directly.
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
  UsecaseBreakdownApiResponse,
  UsecaseApiRow,
  BestPerformersApiResponse,
  BestPerformerRow,
  ResultsApiResponse,
  EvaluationApiRow,
} from './types'
import type { DrilldownResult, DrilldownField } from './data-provider'
import { TENANT_CONFIG, type PharmaTenant } from './pharma-tenant'

const PASS_THRESHOLD = 70 // matches every tenant's own pass/fail convention (>=70)

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

// sim.demorp6's row shape (Weser, Adium, and Sanfer's own DB2 path) —
// PascalCase Spanish keys, distinct from cert.sessions' snake_case shape.
interface SimDemorp6Row {
  ID_Sim: number
  ID_Caso_de_Uso: number
  Usuario: string
  Usuario_Nombre: string
  Fecha_y_Hora: string
  Calificacion: number
}

async function fetchSaleExercisesSessions(
  tenant: PharmaTenant,
  fromIso: string,
  toIso: string,
): Promise<SaleExercisesRow[]> {
  const cfg = TENANT_CONFIG[tenant]
  const date_from = isoToDate(fromIso)
  const date_to   = isoToDate(toIso)

  if (!cfg.ucids) {
    // Sanfer — no fixed ucid list, cert.sessions scans every usecase active
    // in the window and already returns the normalized shape directly.
    const resp = await bridgeCall<{ data: SaleExercisesRow[] }>(tenant, 'cert.sessions', {
      date_from, date_to, limit: 20_000, refresh: 1,
    })
    return resp.data ?? []
  }

  // Weser / Adium — small fixed ucid list, sim.demorp6 requires explicit ids.
  const [sessionsResp, namesResp] = await Promise.all([
    bridgeCall<{ data: SimDemorp6Row[] }>(tenant, 'sim.demorp6', {
      ids: cfg.ucids.join(','), date_from, date_to,
    }),
    bridgeCall<{ data: { ID_Caso_de_Uso: number; Caso_de_Uso: string }[] }>(tenant, 'activities.demorp6', {
      ids: cfg.ucids.join(','),
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

// ── 1. Overview ───────────────────────────────────────────────────────────────

export async function pharmaDashboardOverview(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; prevFromIso: string; prevToIso: string },
): Promise<OverviewApiResponse> {
  if (TENANT_CONFIG[tenant].kind === 'kpi') {
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
  const agg = (rows: SaleExercisesRow[]) => {
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
  const cur  = agg(curRows)
  const prev = agg(prevRows)
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
  params: { fromIso: string; toIso: string },
): Promise<TrendsApiResponse> {
  if (TENANT_CONFIG[tenant].kind === 'kpi') {
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
  return { scoreTrend, passFailTrend, evalCountTrend }
}

// ── 3. Usecase breakdown ──────────────────────────────────────────────────────

export async function pharmaDashboardUsecaseBreakdown(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string },
): Promise<UsecaseBreakdownApiResponse> {
  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    const resp = await bridgeCall<{ activities: ApotexActivityRow[] }>(tenant, 'kpi.activity_summary', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso),
    })
    const data: UsecaseApiRow[] = (resp.activities ?? [])
      .filter(a => Number(a.sessions) > 0)
      .map(a => ({
        usecaseId:        a.activity_id,
        usecase_name:     a.activity_name,
        totalEvaluations: Number(a.sessions),
        avgScore:         a.avg_score != null ? Number(a.avg_score) : null,
        passRate:         a.pass_rate_pct != null ? Number(a.pass_rate_pct) : null,
        passed:           Number(a.sessions_pass),
      }))
    return { data }
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
  params: { fromIso: string; toIso: string; limit: number },
): Promise<BestPerformersApiResponse> {
  const limit = Math.min(Math.max(1, params.limit), 20)

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
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
  return { data }
}

// ── 5. Individual results ─────────────────────────────────────────────────────

export async function pharmaDashboardResults(
  tenant: PharmaTenant,
  params: { fromIso: string; toIso: string; limit: number },
): Promise<ResultsApiResponse> {
  const limit = Math.min(Math.max(1, params.limit), 200)

  if (TENANT_CONFIG[tenant].kind === 'kpi') {
    const resp = await bridgeCall<{ sessions: ApotexSessionRow[] }>(tenant, 'kpi.sessions', {
      date_from: isoToDate(params.fromIso), date_to: isoToDate(params.toIso), limit,
    })
    const data: EvaluationApiRow[] = (resp.sessions ?? []).map(r => {
      const score  = Number(r.score)
      const passed = score >= PASS_THRESHOLD
      return {
        savedReportId: Number(r.id),
        usecaseId:     Number(r.usecase_id ?? r.activity_id),
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
        score:         r.score,
        result:        passed ? 'passed' : 'failed',
        passed,
        date:          r.date.slice(0, 10),
      }
    })
  return { data }
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

export async function pharmaDashboardDrilldown(
  tenant: PharmaTenant,
  savedReportId: number,
): Promise<DrilldownResult | null> {
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
