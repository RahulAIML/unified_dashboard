/**
 * Translates the FIXED, ENUMERABLE English strings the AI Dashboard Builder
 * bakes into a persisted DashboardConfig (widget titles, business_question
 * subtitles, page/row titles, table column headers) -- these come from a
 * closed, finite vocabulary of Python string literals in ai-service's
 * schema_discovery.py/dashboard_planning.py (never per-client LLM prose), so
 * they can be translated by exact-string lookup, unlike a genuinely free-form
 * LLM sentence (DashboardConfig.recommendations/insights), which this file
 * deliberately does NOT touch -- see docs/PRODUCTION_READINESS_AUDIT.md for
 * why that requires generation-time language plumbing instead.
 *
 * This works retroactively for dashboards published before this file existed
 * (the lookup happens at render time, not generation time) and safely no-ops
 * for anything not in the dictionary -- an unmapped string renders exactly as
 * generated, in whatever language it was written, rather than being blanked
 * or garbled. That's a deliberate "never fabricate a translation" choice: a
 * missing entry is a gap to fill in later, not a crash or a guess.
 */
import type { Lang } from './translations'

// Exact-match dictionary, EN -> ES. Source strings are collected verbatim
// from ai-service/app/agents/schema_discovery.py (DiscoveredMetric.label +
// business_question, every connector) and
// ai-service/app/agents/dashboard_planning.py (every literal page/row/widget
// title and business_question). Keep this in sync if either file's literals
// change -- there is no automated link between them and this dictionary.
const GENERATED_ES: Record<string, string> = {
  // ── Page titles (dashboard_planning.py) ─────────────────────────────────
  'Overview': 'Resumen',
  'Analytics': 'Analítica',
  'KPIs': 'KPIs',
  'Activities': 'Actividades',
  'Reports': 'Reportes',
  'Ranking': 'Ranking',
  'LMS': 'LMS', // brand/module name, not translated elsewhere either
  'Master Coach': 'Coach Maestro',
  'Practice Simulator': 'Simulador de Práctica',
  'Certification': 'Certificación',
  'Second Brain': 'Second Brain', // brand name
  'Activity Tracking': 'Seguimiento de Actividad',
  'Practice Sessions': 'Sesiones de Práctica',
  'Coach Analytics': 'Analítica de Coach',
  'Organization': 'Organización',

  // ── Row titles (dashboard_planning.py) ──────────────────────────────────
  'Leaderboard': 'Tabla de Posiciones',
  'Adoption, Efficiency & Readiness': 'Adopción, Eficiencia y Preparación',
  'Commercial Effectiveness & Impact': 'Efectividad Comercial e Impacto',
  'Per-Simulator Breakdown': 'Desglose por Simulador',
  'All Sessions': 'Todas las Sesiones',
  'Full Roster': 'Plantilla Completa',

  // ── Widget titles shared across every connector (schema_discovery.py) ──
  'Total Sessions': 'Sesiones Totales',
  'Active Users': 'Usuarios Activos',
  'Registered Users': 'Usuarios Registrados',
  'Average Score': 'Puntuación Promedio',
  'Pass Rate': 'Tasa de Aprobación',
  'Score Trend': 'Tendencia de Puntuación',
  'Sessions by Activity': 'Sesiones por Actividad',
  'Sessions by Usecase': 'Sesiones por Caso de Uso',
  'Certified': 'Certificados',

  // ── rolplay_app_sql-specific widget titles ──────────────────────────────
  'By Simulator': 'Por Simulador',
  'Activation Rate': 'Tasa de Activación',
  'Weekly Practice Frequency': 'Frecuencia de Práctica Semanal',
  'Recurring Adoption (MAU)': 'Adopción Recurrente (MAU)',
  'Competency Gain (Delta Score)': 'Ganancia de Competencia (Delta de Puntuación)',
  'Field Readiness Index': 'Índice de Preparación de Campo',
  'Distribution by Mastery Level': 'Distribución por Nivel de Dominio',
  'Adoption Movement Rate': 'Tasa de Movimiento de Adopción',
  'Score by Commercial Domain': 'Puntuación por Dominio Comercial',
  'Top Commercial Strengths': 'Principales Fortalezas Comerciales',
  'Top Areas of Opportunity': 'Principales Áreas de Oportunidad',
  'Best Performers': 'Mejores Desempeños',
  'Sessions by Simulator': 'Sesiones por Simulador',
  'Session Reports': 'Reportes de Sesiones',
  'Solution Journey': 'Recorrido de la Solución',
  'Pass / Fail Breakdown': 'Desglose de Aprobados / Reprobados',
  'Daily Sessions & Pass Count': 'Sesiones Diarias y Conteo de Aprobados',

  // ── coach_app_sql-specific ───────────────────────────────────────────────
  'Recent Sessions': 'Sesiones Recientes',

  // ── second_brain-specific (schema_discovery.py) ─────────────────────────
  'Coaching Sessions': 'Sesiones de Coaching',
  'Members': 'Miembros',
  'Messages': 'Mensajes',
  'Engagement': 'Interacción',

  // ── LMS-specific (lms_discovery.py / dashboard_planning.py::_lms_page) ──
  'Enrolled Users': 'Usuarios Inscritos',
  'Completion Rate': 'Tasa de Finalización',
  'Avg Quiz Score': 'Puntuación Prom. de Examen',
  'Modules Completed': 'Módulos Completados',
  'LMS Completions': 'Finalizaciones de LMS',
  'Courses': 'Cursos',

  // ── Donut/breakdown slice labels (preview_fetch.py) ─────────────────────
  'Passed': 'Aprobado',
  'Failed': 'Reprobado',
  'Basic (<75)': 'Básico (<75)',
  'Intermediate (75-94)': 'Intermedio (75-94)',
  'Advanced (>=95)': 'Avanzado (>=95)',

  // ── Business questions (subtitles) — schema_discovery.py, rolplay_app_sql ─
  'How many practice sessions have reps completed?': '¿Cuántas sesiones de práctica han completado los representantes?',
  'How many reps are actively using the platform?': '¿Cuántos representantes usan la plataforma activamente?',
  'How many people have an account on this platform, whether or not they\'ve started using it?': '¿Cuántas personas tienen una cuenta en esta plataforma, hayan empezado a usarla o no?',
  'What % of enrolled reps have started at least one session?': '¿Qué % de representantes inscritos ha iniciado al menos una sesión?',
  'How many sessions run per active week, on average?': '¿Cuántas sesiones se ejecutan por semana activa, en promedio?',
  'What % of reps used the platform in the last 30 days?': '¿Qué % de representantes usó la plataforma en los últimos 30 días?',
  'How much do reps improve from their first to their most recent session?': '¿Cuánto mejoran los representantes desde su primera hasta su sesión más reciente?',
  'What % of the sales force has reached mastery-level certification?': '¿Qué % de la fuerza de ventas ha alcanzado el nivel de dominio?',
  'How well are reps performing in practice?': '¿Qué tan bien están desempeñándose los representantes en la práctica?',
  'What share of practice sessions meet the passing bar?': '¿Qué proporción de sesiones de práctica alcanza el umbral de aprobación?',
  'Is performance improving or declining over time?': '¿El desempeño mejora o empeora con el tiempo?',
  'Which practice scenarios are reps using, and how do they perform on each?': '¿Qué escenarios de práctica usan los representantes y cómo se desempeñan en cada uno?',

  // ── Business questions — dashboard_planning.py ──────────────────────────
  'Which reps have the highest average score?': '¿Qué representantes tienen la puntuación promedio más alta?',
  'What share of the team is Basic / Intermediate / Advanced?': '¿Qué proporción del equipo está en nivel Básico / Intermedio / Avanzado?',
  'What % of sessions moved the customer\'s adoption intent forward?': '¿Qué % de sesiones hizo avanzar la intención de adopción del cliente?',
  'In which stage of the sales interaction does the team struggle most?': '¿En qué etapa de la interacción de venta el equipo tiene más dificultades?',
  'Which skills does the team consistently execute well?': '¿Qué habilidades ejecuta el equipo consistentemente bien?',
  'Which specific habits most often fail across real sessions?': '¿Qué hábitos específicos fallan con más frecuencia en sesiones reales?',
  'Which simulators are used most, and how do they perform?': '¿Qué simuladores se usan más y cómo se desempeñan?',
  'Which individual sessions were run, by whom, and with what result?': '¿Qué sesiones individuales se ejecutaron, por quién y con qué resultado?',
  'How many sessions run per day, and how many pass?': '¿Cuántas sesiones se ejecutan por día y cuántas aprueban?',
  'Who has an account on this platform, whether or not they\'ve started using it?': '¿Quién tiene una cuenta en esta plataforma, haya empezado a usarla o no?',
}

// "{X} — detail" / "{X} — Share" composite titles (dashboard_planning.py's
// f"{label} — detail" / f"{dim.label} — Share" patterns) -- translating the
// suffix generically means this covers every module/dimension label,
// including ones not explicitly listed above, rather than needing one
// dictionary entry per label x suffix combination.
const SUFFIX_ES: Record<string, string> = {
  detail: 'detalle',
  Share: 'Participación',
}

/** True source-of-truth check: is this dictionary's source language English? Yes -- every literal above was copied verbatim from the Python source, which is always English. */
export function translateGeneratedText(text: string | null | undefined, lang: Lang): string {
  if (!text) return ''
  if (lang !== 'es') return text
  const exact = GENERATED_ES[text]
  if (exact) return exact

  const suffixMatch = /^(.+) — (detail|Share)$/.exec(text)
  if (suffixMatch) {
    const [, label, suffix] = suffixMatch
    return `${GENERATED_ES[label] ?? label} — ${SUFFIX_ES[suffix]}`
  }

  // DashboardConfig.title = f"{company} Analytics" (dashboard_config.py) --
  // only the fixed " Analytics" suffix is ours to translate; the company
  // name itself must pass through unchanged.
  if (text.endsWith(' Analytics')) {
    return `${text.slice(0, -' Analytics'.length)} Analítica`
  }

  return text
}

// Known raw SQL/JSON column names rendered as table headers in MiniTable/
// ReportsTable (components/DashboardRenderer.tsx), which otherwise just do
// `c.replace(/_/g, ' ')` on whatever column name the query returns -- always
// English/DB-schema-derived. Keyed on the RAW column name (before the
// underscore-to-space replace), covering every column alias seen across
// lib/bridge-rolplay-app.ts and ai-service/app/preview_fetch.py's
// rolplay_app_sql queries. Falls back to the existing underscore-replace
// behavior for anything not listed -- a new/unmapped column still renders,
// just untranslated, rather than breaking.
const COLUMN_HEADER_ES: Record<string, string> = {
  date: 'Fecha',
  rep: 'Representante',
  simulator: 'Simulador',
  score: 'Puntuación',
  result: 'Resultado',
  domain: 'Dominio',
  item: 'Elemento',
  count: 'Cantidad',
  sessions: 'Sesiones',
  total_sessions: 'Sesiones Totales',
  passed_sessions: 'Sesiones Aprobadas',
  avg_score: 'Puntuación Prom.',
  pass_rate: 'Tasa de Aprobación',
  user_email: 'Correo',
  user_name: 'Nombre',
  email: 'Correo',
  name: 'Nombre',
  module: 'Módulo',
  label: 'Etiqueta',
  phase: 'Fase',
  department: 'Departamento',
  designation: 'Puesto',
  created_on: 'Fecha de Registro',
  last_loggedin: 'Último Inicio de Sesión',
  status: 'Estado',
}

export function translateColumnHeader(column: string, lang: Lang): string {
  if (lang === 'es' && COLUMN_HEADER_ES[column]) return COLUMN_HEADER_ES[column]
  return column.replace(/_/g, ' ')
}

// The Reports table's "result" column value comes straight from a SQL CASE
// expression's own literal strings ('Passed'/'Failed' -- ai-service's
// preview_fetch.py), not a translation-aware label -- unlike a column
// HEADER (always one of a fixed, known set of names), a table CELL value
// could be anything (a rep's email, a simulator name), so this is only ever
// applied at the one call site that renders the "result" column
// specifically, never generically to every cell.
const RESULT_VALUE_ES: Record<string, string> = { Passed: 'Aprobado', Failed: 'Reprobado' }

export function translateResultValue(value: string, lang: Lang): string {
  if (lang === 'es' && RESULT_VALUE_ES[value]) return RESULT_VALUE_ES[value]
  return value
}

// Same closed-vocabulary pattern as RESULT_VALUE_ES above, for the
// Organization page's roster "status" column (ai-service's preview_fetch.py
// emits literal 'Active'/'Disabled' from r_user.disabled).
const STATUS_VALUE_ES: Record<string, string> = { Active: 'Activo', Disabled: 'Deshabilitado' }

export function translateStatusValue(value: string, lang: Lang): string {
  if (lang === 'es' && STATUS_VALUE_ES[value]) return STATUS_VALUE_ES[value]
  return value
}

// Pass-rate KPI tile legends -- generated server-side with the actual
// configured threshold baked in as a number (lib/kpi-builder.ts::
// passRateLegend for the hand-built dashboard, ai-service/app/
// preview_fetch.py::_pass_rate_legend for the AI Dashboard Builder), so they
// can't be an exact-string lookup like GENERATED_ES above -- the number
// varies per tenant. Pattern-matched instead, same "translate a closed,
// backend-generated vocabulary at render time" approach as the rest of this
// file.
const PASS_THRESHOLD_LEGEND_RE = /^(?:Pass threshold: score ≥ |Passing threshold: )(\d+(?:\.\d+)?) pts$/
const OTHER_LEGEND_ES: Record<string, string> = {
  'Pass rate as reported by the source system': 'Tasa de aprobación según la reporta el sistema de origen',
  'Certified: % of users who completed every assigned simulation': 'Certificado: % de usuarios que completaron todas las simulaciones asignadas',
}

export function translateLegend(legend: string | null | undefined, lang: Lang): string {
  if (!legend) return ''
  if (lang !== 'es') return legend
  const m = PASS_THRESHOLD_LEGEND_RE.exec(legend)
  if (m) return `Umbral de aprobación: puntuación ≥ ${m[1]} pts`
  return OTHER_LEGEND_ES[legend] ?? legend
}
