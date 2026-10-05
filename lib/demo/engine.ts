/**
 * lib/demo/engine.ts
 *
 * Centralized mock analytics engine for DEMO MODE.
 *
 * Generates realistic enterprise sales-coaching analytics data that is:
 *   - Date-range-aware (numbers scale with the requested window)
 *   - Deterministic (same range → same data, so no flicker on re-render)
 *   - Internally consistent (passedEvaluations = totalEvaluations × passRate)
 *   - Visually rich (positive deltas, diverse use cases, real user names)
 *
 * Architecture:
 *   API route → isDemoMode() check → demoEngine.*() → return response
 *   Real API  → isDemoMode() false → existing bridge/DB logic
 *
 * Future migration: flip NEXT_PUBLIC_DEMO_MODE=false. Zero refactor needed.
 */

// ── Tiny seeded PRNG (mulberry32) ────────────────────────────────────────────
// Ensures the same date range always produces the same numbers.
function seededRng(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff
  }
}

function dateToSeed(from: Date, to: Date, salt = 0): number {
  return (
    (from.getFullYear() * 1_000_000 +
    (from.getMonth() + 1) * 10_000 +
    from.getDate() * 100 +
    to.getDate()) ^ salt
  )
}

function solutionSalt(solution: string | null): number {
  if (!solution) return 0
  let hash = 0
  for (let i = 0; i < solution.length; i++) {
    hash = ((hash << 5) - hash) + solution.charCodeAt(i)
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000))
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// Real production benchmark, verified live against M8 (a genuinely
// well-established rolplay_app_sql client): ~900 sessions total across its
// ENTIRE history, spanning multiple modules. Demo data used a flat per-day
// rate multiplied by raw calendar days, so the default "All" view (10
// years -- ALL_TIME_DAYS in DashboardHeader.tsx) produced 130K-245K
// evaluations per module: 100-200x larger than a real established client,
// which made every KPI impossible to sanity-check by hand and every trend
// chart plot an unreadable value range (reported directly in the Aug 20/21
// sprint reviews). `activityDays` scales exactly linearly with the
// requested range up to 90 days (so a normal week/month/quarter demo view
// is completely unchanged from before), then grows sublinearly beyond that
// -- an established synthetic company's pace of NEW activity plateaus over
// years the same way a real one's does, without going so flat that "all
// time" and "last 30 days" read as roughly the same total (a first version
// of this curve over-corrected into exactly that -- days=30 and
// days=3650 landed within ~4.5x of each other, which looks like the
// company went dormant, not established).
function activityDays(days: number): number {
  if (days <= 90) return days
  return 90 + Math.pow(days - 90, 0.6) * 3
}

// ── Demo constants ────────────────────────────────────────────────────────────
export const DEMO_USECASE_IDS = [101, 102, 103, 104, 105] as const

export const DEMO_USECASES: Record<number, string> = {
  101: 'Dominio de Llamadas de Descubrimiento',
  102: 'Profesional en Manejo de Objeciones',
  103: 'Excelencia en Demostración de Producto',
  104: 'Técnicas de Negociación',
  105: 'Análisis Técnico Profundo',
}

const DEMO_USECASES_EN: Record<number, string> = {
  101: 'Discovery Call Mastery',
  102: 'Objection Handling Pro',
  103: 'Product Demo Excellence',
  104: 'Negotiation Techniques',
  105: 'Deep Technical Analysis',
}

function usecaseLabel(id: number, lang: 'en' | 'es'): string {
  return (lang === 'en' ? DEMO_USECASES_EN[id] : DEMO_USECASES[id]) ?? `Scenario ${id}`
}

// Demo drilldown report IDs — these map to entries in reports.ts
export const DEMO_REPORT_IDS = Array.from({ length: 20 }, (_, i) => 5001 + i)

const DEMO_USERS = [
  { name: 'María García',      email: 'mgarcia@demo.rolplay.ai'   },
  { name: 'Carlos López',      email: 'clopez@demo.rolplay.ai'    },
  { name: 'Ana Martínez',      email: 'amartinez@demo.rolplay.ai' },
  { name: 'Diego Hernández',   email: 'dhernandez@demo.rolplay.ai'},
  { name: 'Sofia Ramírez',     email: 'sramirez@demo.rolplay.ai'  },
  { name: 'Luis Torres',       email: 'ltorres@demo.rolplay.ai'   },
  { name: 'Valentina Cruz',    email: 'vcruz@demo.rolplay.ai'     },
  { name: 'Andrés Flores',     email: 'aflores@demo.rolplay.ai'   },
  { name: 'Isabella Reyes',    email: 'ireyes@demo.rolplay.ai'    },
  { name: 'Miguel Castillo',   email: 'mcastillo@demo.rolplay.ai' },
  { name: 'Camila Morales',    email: 'cmorales@demo.rolplay.ai'  },
  { name: 'Sebastián Jiménez', email: 'sjimenez@demo.rolplay.ai'  },
  { name: 'Lucía Vargas',      email: 'lvargas@demo.rolplay.ai'   },
  { name: 'Roberto Sánchez',   email: 'rsanchez@demo.rolplay.ai'  },
  { name: 'Fernanda Ruiz',     email: 'fruiz@demo.rolplay.ai'     },
]

// Solution-specific base rates. Deliberately modest: this is a straight
// per-day multiplier with no growth curve, so the "All" filter (10 years,
// see ALL_TIME_DAYS in DashboardHeader.tsx) multiplies it by 3650 days --
// the previous rates (up to 102/day) produced 400K+ session totals that
// read as absurd rather than impressive, and made every trend chart plot
// an unreadable, densely-packed value range.
const RATE_MAP: Record<string, number> = {
  'lms': 42, 'coach': 58, 'simulator': 50, 'certification': 36, 'second-brain': 0,
}
const REAL_SOLUTIONS = Object.keys(RATE_MAP)

export interface DemoOverview {
  totalEvaluations: number
  avgScore: number
  passRate: number
  passedEvaluations: number
  prevTotalEvaluations: number
  prevAvgScore: number
  prevPassRate: number
}

// ── Overview KPIs ─────────────────────────────────────────────────────────────
// "All" (solution === null) must be a real aggregate of the per-module
// figures below it, never an independently-drawn number -- a prospect
// filtering by a single module previously saw MORE sessions than "All"
// (e.g. Master Coach's flat 58/day rate vs. All's own unrelated flat
// 52/day fallback), an internally impossible "part > whole" result. This
// recurses per real module and sums/reweights instead of drawing its own
// disconnected constant.
export function demoOverview(from: Date, to: Date, solution: string | null = null): DemoOverview {
  if (!solution) {
    const parts = REAL_SOLUTIONS.map(s => demoOverview(from, to, s))
    const totalEvaluations = parts.reduce((s, p) => s + p.totalEvaluations, 0)
    const passedEvaluations = parts.reduce((s, p) => s + p.passedEvaluations, 0)
    const prevTotalEvaluations = parts.reduce((s, p) => s + p.prevTotalEvaluations, 0)
    const prevPassedEvaluations = parts.reduce(
      (s, p) => s + Math.round(p.prevTotalEvaluations * (p.prevPassRate / 100)), 0,
    )
    const weightedAvg = (key: 'avgScore' | 'prevAvgScore', weightKey: 'totalEvaluations' | 'prevTotalEvaluations') => {
      const weight = parts.reduce((s, p) => s + p[weightKey], 0)
      if (!weight) return parts[0][key]
      return Math.round((parts.reduce((s, p) => s + p[key] * p[weightKey], 0) / weight) * 10) / 10
    }
    return {
      totalEvaluations,
      avgScore:             weightedAvg('avgScore', 'totalEvaluations'),
      passRate:             totalEvaluations ? Math.round((100 * passedEvaluations / totalEvaluations) * 10) / 10 : 0,
      passedEvaluations,
      prevTotalEvaluations,
      prevAvgScore:         weightedAvg('prevAvgScore', 'prevTotalEvaluations'),
      prevPassRate:         prevTotalEvaluations ? Math.round((100 * prevPassedEvaluations / prevTotalEvaluations) * 10) / 10 : 0,
    }
  }

  const days = daysBetween(from, to)
  const salt = solutionSalt(solution)
  const rng  = seededRng(dateToSeed(from, to, salt))

  const baseRate = RATE_MAP[solution] ?? 52
  const dailyRate   = baseRate + rng() * 9
  const totalEvals  = Math.round(dailyRate * activityDays(days))

  // Solution-specific score ranges
  const scoreMap: Record<string, [number, number]> = {
    'lms': [78, 4], 'coach': [84, 5], 'simulator': [81, 6], 'certification': [82, 4],
  }
  const [scoreBase, scoreVar] = scoreMap[solution] || [83, 4]
  const avgScore    = Math.round((scoreBase + rng() * scoreVar) * 10) / 10

  // Solution-specific pass rates
  const passMap: Record<string, [number, number]> = {
    'lms': [72, 8], 'coach': [76, 6], 'simulator': [79, 5], 'certification': [81, 4],
  }
  const [passBase, passVar] = passMap[solution] || [74, 7]
  const passRate    = Math.round((passBase + rng() * passVar) * 10) / 10
  const passed      = Math.round(totalEvals * (passRate / 100))

  // Prior period (slightly lower to show positive growth)
  const prevTotal   = Math.round(totalEvals * (0.8 + rng() * 0.1))
  const prevScore   = Math.round((avgScore - 2.2 - rng() * 1.5) * 10) / 10
  const prevPass    = Math.round((passRate - 3.2 - rng() * 1.8)  * 10) / 10

  return {
    totalEvaluations:     totalEvals,
    avgScore:             avgScore,
    passRate:             passRate,
    passedEvaluations:    passed,
    prevTotalEvaluations: prevTotal,
    prevAvgScore:         prevScore,
    prevPassRate:         prevPass,
  }
}

// ── Trends ────────────────────────────────────────────────────────────────────
/**
 * Bucket size (in days) so a trend chart never has to plot more than ~130
 * points no matter how wide the requested range is. The "All" filter is 10
 * years (ALL_TIME_DAYS in DashboardHeader.tsx) -- one point per day there
 * would be 3650 points squeezed into a normal chart width, rendering as a
 * solid, unreadable block rather than a legible trend.
 */
function bucketSizeDays(totalDays: number): number {
  if (totalDays <= 120) return 1       // daily
  if (totalDays <= 730) return 7       // weekly (up to ~2 years)
  return 30                            // monthly beyond that
}

export function demoTrends(from: Date, to: Date, solution: string | null = null) {
  const days   = daysBetween(from, to)
  const salt   = solutionSalt(solution)
  const rng    = seededRng(dateToSeed(from, to, salt) + 7)
  const bucket = bucketSizeDays(days)

  // Anchored to demoOverview's REAL totalEvaluations for this (solution,
  // from, to) -- previously this trend's day-of-week volume model (46-70/day
  // weekday, 12-24/day weekend) was a completely separate RNG stream from
  // Overview's flat daily rate, so summing this chart's points never matched
  // the Overview tile shown right above it for the same module/range. Each
  // day's expected share is its weekday/weekend weight over the range's total
  // weight, times the real total -- the weekday/weekend shape is preserved,
  // but the sum now tracks the actual Overview number instead of drifting
  // from an unrelated model.
  const overview = demoOverview(from, to, solution)
  const dayWeight = (d: Date) => { const dow = d.getDay(); return dow > 0 && dow < 6 ? 1 : 0.35 }
  let weightSum = 0
  for (let i = 0; i < days; i++) weightSum += dayWeight(addDays(from, i))
  const perWeightUnit = weightSum > 0 ? overview.totalEvaluations / weightSum : 0

  const scoreTrend:     { date: string; value: number }[]                   = []
  const passFailTrend:  { date: string; value: number; value2: number }[]   = []
  const evalCountTrend: { date: string; value: number }[]                   = []

  for (let start = 0; start < days; start += bucket) {
    const span = Math.min(bucket, days - start)
    const d    = addDays(from, start)
    const ymd  = toYMD(d)

    // Smooth upward score trend across the whole range: starts ~81, ends ~87.
    // Averaged across the bucket rather than summed -- score isn't additive.
    const progress  = days > 1 ? start / (days - 1) : 1
    const baseScore = 81 + progress * 6
    const jitter    = (rng() - 0.5) * 4
    scoreTrend.push({ date: ymd, value: Math.round((baseScore + jitter) * 10) / 10 })

    // Eval count is each real day's share of the range's true total,
    // weighted by weekday/weekend and jittered (centered at 1x, so the
    // bucket sum stays close to its fair share of the real Overview total).
    let evals = 0
    for (let i = 0; i < span; i++) {
      const day = addDays(d, i)
      evals += Math.round(perWeightUnit * dayWeight(day) * (0.85 + rng() * 0.3))
    }
    evalCountTrend.push({ date: ymd, value: evals })

    const passRate = 0.73 + progress * 0.08 + (rng() - 0.5) * 0.06
    const passed   = Math.round(evals * Math.min(0.95, Math.max(0.55, passRate)))
    const failed   = evals - passed
    passFailTrend.push({ date: ymd, value: passed, value2: failed })
  }

  return { scoreTrend, passFailTrend, evalCountTrend }
}

// ── Usecase Breakdown ─────────────────────────────────────────────────────────
// Anchored to demoOverview's REAL totalEvaluations/avgScore/passRate for the
// same (solution, from, to) rather than an independently-rolled total --
// previously this table and the Overview tile above it were two disconnected
// RNG streams (different base rate, no shared driver), so a viewer comparing
// them saw numbers with no relationship to each other. Rows still get their
// own per-usecase variance (weights, small score/pass jitter), but the sum
// across rows now equals the real Overview total, matching how a client's
// actual usecase breakdown always sums back to their actual total sessions.
export function demoUsecaseBreakdown(from: Date, to: Date, solution: string | null, lang: 'en' | 'es' = 'es') {
  const salt     = solutionSalt(solution)
  const rng      = seededRng(dateToSeed(from, to, salt) + 13)
  const overview = demoOverview(from, to, solution)

  // Distribution weights (sum to 1.0) for the "All" case's 5 usecases.
  const weights = [0.28, 0.24, 0.22, 0.15, 0.11]

  // One deterministic usecase per real module (not always index 0 -- the old
  // predicate matched every valid `solution` value, so every module's
  // breakdown showed the same usecase). REAL_SOLUTIONS order matches
  // RATE_MAP/demoOverview's own module list.
  const moduleIdx = solution ? REAL_SOLUTIONS.indexOf(solution) : -1
  const ids = solution
    ? [DEMO_USECASE_IDS[moduleIdx >= 0 ? moduleIdx % DEMO_USECASE_IDS.length : 0]]
    : [...DEMO_USECASE_IDS]

  const rows = ids.map((ucId, i) => {
    const weight = solution ? 1 : (weights[i] ?? 0.2)
    const total  = Math.round(overview.totalEvaluations * weight)
    // Small jitter around the module's REAL average/pass rate, not an
    // independent roll -- keeps each usecase plausible on its own while
    // still visibly related to the Overview tile for the same module.
    const score  = Math.max(0, Math.min(100, Math.round((overview.avgScore + (rng() - 0.5) * 6) * 10) / 10))
    const pr     = Math.max(0, Math.min(100, Math.round((overview.passRate + (rng() - 0.5) * 8) * 10) / 10))
    const passed = Math.round(total * (pr / 100))

    return {
      usecaseId:        ucId,
      usecase_name:     usecaseLabel(ucId, lang),
      totalEvaluations: total,
      avgScore:         score,
      passRate:         pr,
      passed,
    }
  })

  return { data: rows }
}

// ── Evaluation Results Table ──────────────────────────────────────────────────
export function demoResults(from: Date, to: Date, limit = 20, solution: string | null) {
  const days = daysBetween(from, to)
  const salt = solutionSalt(solution)
  const rng  = seededRng(dateToSeed(from, to, salt) + 17)

  const ucIds = solution
    ? ([DEMO_USECASE_IDS[0]] as number[])
    : [...DEMO_USECASE_IDS]

  const rows = DEMO_REPORT_IDS.slice(0, limit).map((reportId, i) => {
    const ucId  = ucIds[i % ucIds.length]
    const score = Math.round(60 + rng() * 38)
    const passed = score >= 75
    const daysAgo = Math.floor(rng() * Math.min(days, 30))
    const date    = toYMD(addDays(to, -daysAgo))

    return {
      savedReportId: reportId,
      usecaseId:     ucId,
      score,
      result:        passed ? 'Pass' : 'Fail',
      passed,
      date,
    }
  })

  return { data: rows }
}

// ── Best Performers ───────────────────────────────────────────────────────────
export function demoBestPerformers(from: Date, to: Date, limit = 5, solution: string | null = null) {
  const days = daysBetween(from, to)
  const salt = solutionSalt(solution)
  const rng  = seededRng(dateToSeed(from, to, salt) + 23)
  // Anchored to the module's REAL average -- a top performer is, by
  // definition, ABOVE the tenant's own average score/pass rate, not an
  // absolute number independent of it (previously avg_score/pass_rate were
  // rolled from a completely separate range than Overview's avgScore/
  // passRate for the same module, so the leaderboard could show a "best
  // performer" doing worse than the tenant's own reported average).
  const overview = demoOverview(from, to, solution)

  return {
    data: DEMO_USERS.slice(0, limit).map(u => ({
      user_email: u.email,
      user_name:  u.name,
      // Capped rather than scaled straight off `days`: a real person's
      // cumulative session count can't keep climbing linearly over a 10-year
      // "All time" range (that's several sessions every single day for a
      // decade) -- realistic even for a top performer over any range.
      sessions:   Math.round(Math.min(days, 400) * (0.8 + rng() * 1.2)),
      avg_score:  Math.max(0, Math.min(100, Math.round((overview.avgScore + 4 + rng() * 10) * 10) / 10)),
      pass_rate:  Math.max(0, Math.min(100, Math.round((overview.passRate + 3 + rng() * 15) * 10) / 10)),
    })),
  }
}

// ── Access Status ─────────────────────────────────────────────────────────────
export function demoAccessStatus() {
  // The demo dashboard must showcase the FULL Rolplay ecosystem, so every
  // capability is on: this drives the nav (Activities, Conversational, Business
  // Lines, Organization, Reports) as well as the module set. Demo data is only
  // ever served to Rolplay's own domains (see isRolplayDemoTenant).
  return {
    hasCoachData:        true,
    hasSecondBrainData:  true,
    hasBancoAccess:      false,
    hasPharmaAccess:     true,
    hasRolplayAppAccess: true,
    hasAnyAccess:        true,
    hasBusinessLines:    true,
  }
}

// ── Second Brain Profile ──────────────────────────────────────────────────────
const SB_MEMBER_NAMES = [
  'María García', 'Carlos López', 'Ana Martínez', 'Diego Hernández', 'Sofia Ramírez',
  'Luis Torres', 'Valentina Cruz', 'Andrés Flores', 'Isabella Reyes', 'Miguel Castillo',
  'Camila Morales', 'Sebastián Jiménez', 'Lucía Vargas', 'Roberto Sánchez', 'Fernanda Ruiz',
  'Jorge Rivera', 'Elena Delgado', 'Marcos Núñez', 'Patricia Romero', 'Alberto Méndez',
  'Adriana Silva', 'Felipe Herrera', 'Mónica González', 'Raúl Ibáñez', 'Catalina Peña',
  'Gustavo Rojas', 'Beatriz Acosta', 'Oscar Moreno', 'Natalia Castells', 'Eduardo Fuentes',
  'Gabriela Ortiz', 'Manuel Blanco', 'Mariana Valdez', 'Ricardo Prado', 'Vanessa Aguirre',
  'Javier Dominguez', 'Lorena Miranda', 'Fernando Soto', 'Rosario Díaz', 'Álvaro Vásquez',
  'Emilia Rodríguez', 'Sergio Pacheco', 'Juliana Becerra', 'Víctor Ramírez', 'Sandra Celis',
  'Ignacio Salazar', 'Pamela Ovando',
]

const SB_ROLES = [
  'Sales Manager', 'Operations Lead', 'Revenue Director', 'Team Lead', 'Coordinator',
  'Executive', 'Analyst', 'Specialist', 'Supervisor', 'Administrator',
]

export function demoSecondBrainProfile() {
  const rng = seededRng(999)
  const activeCount = 39

  const members = SB_MEMBER_NAMES.map((name, i) => ({
    name,
    role: SB_ROLES[Math.floor(rng() * SB_ROLES.length)],
    email: name.toLowerCase().replace(/\s+/g, '.') + '@company.com',
    is_active: i < activeCount,
    last_activity: i < activeCount ? `2026-05-${Math.floor(rng() * 7) + 1}` : null,
  }))

  return {
    stats: {
      total_members:      47,
      active_members:     39,
      total_message_logs: 2841,
      total_documents:    156,
      knowledgebase_docs: 89,
      datastore_docs:     67,
    },
    message_logs: {
      total:          2841,
      recent_30_days: 847,
      rag_queries:    1203,
    },
    members,
  }
}

// ── Business Lines (demo) ─────────────────────────────────────────────────────
// So the Certifier Coach page's per-line section is populated in the demo.

const DEMO_LINES = [
  'Cardiología', 'Respiratorio', 'Dermatología', 'Gastroenterología',
  'Neurociencias', 'Oncología', 'Pediatría', 'Salud Femenina',
]

export function demoBusinessLines(from: Date, to: Date) {
  const rng = seededRng(dateToSeed(from, to, 71))
  const data = DEMO_LINES.map((name, i) => {
    const memberCount = 8 + Math.round(rng() * 22)
    const activeUsers = Math.max(3, memberCount - Math.round(rng() * 5))
    return {
      tagId: 200 + i,
      name,
      memberCount,
      simCount: activeUsers * (2 + Math.round(rng() * 4)),
      avgScore: Math.round((74 + rng() * 20) * 10) / 10,
      activeUsers,
    }
  })
  // Best line first, matching how the real endpoint is consumed.
  data.sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0))
  return { data }
}

// ── Organization (demo) ───────────────────────────────────────────────────────

const DEMO_ADMIN_NAMES = [
  'Alejandra Ruiz', 'Fernando Castillo', 'Patricia Núñez', 'Ricardo Salinas',
]
const DEMO_DESIGNATIONS = [
  'Representante Médico', 'Gerente de Distrito', 'KAM', 'Especialista de Producto',
]

export function demoOrganization() {
  const rng = seededRng(20260101)
  const admins = DEMO_ADMIN_NAMES.map((fullName, i) => ({
    id: 900 + i,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@demo.rolplay.ai`,
    profileType: i === 0 ? 'Admin' : 'Supervisor',
  }))
  const members = SB_MEMBER_NAMES.map((fullName, i) => ({
    id: 1000 + i,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}${i}@demo.rolplay.ai`,
    designation: DEMO_DESIGNATIONS[Math.floor(rng() * DEMO_DESIGNATIONS.length)],
    adminId: admins[i % admins.length].id,
  }))
  return {
    totalMembers: members.length,
    totalAdmins: admins.length,
    totalSupervisors: admins.filter(a => a.profileType === 'Supervisor').length,
    members,
    admins,
  }
}

// ── Objections / Conversational Intelligence (demo) ───────────────────────────

const DEMO_OBJECTIONS: { text: string; model: string }[] = [
  { text: '¿Por qué debería cambiar el tratamiento actual de mi paciente?',
    model: 'Reconoce la experiencia del médico, presenta la evidencia diferencial y propone un perfil de paciente concreto donde el cambio aporta más valor.' },
  { text: 'El precio es más alto que el genérico que ya receto.',
    model: 'Reencuadra de precio a costo total: adherencia, menos recaídas y menos visitas, sustentado con datos de eficacia.' },
  { text: 'No tengo tiempo, sea breve.',
    model: 'Abre con un beneficio en una frase, pide 60 segundos y cierra con un siguiente paso claro.' },
  { text: 'Ya conozco el producto, no necesito información.',
    model: 'Valida su conocimiento y aporta un dato nuevo (indicación reciente o subgrupo) que no suele conocerse.' },
  { text: 'Me preocupan los efectos adversos en adultos mayores.',
    model: 'Presenta el perfil de seguridad en ese subgrupo y las pautas de ajuste de dosis recomendadas.' },
  { text: 'Prefiero esperar más evidencia a largo plazo.',
    model: 'Comparte los datos de extensión disponibles y ofrece iniciar con un paciente de perfil idóneo.' },
]

export function demoObjections(from: Date, to: Date) {
  const rng = seededRng(dateToSeed(from, to, 83))
  const data = DEMO_OBJECTIONS.map((o, i) => ({
    usecaseId: DEMO_USECASE_IDS[i % DEMO_USECASE_IDS.length],
    objectionText: o.text,
    count: 8 + Math.round(rng() * 40),
    passRate: Math.round(rng() * 100),
    modelAnswer: o.model,
    topAnswers: DEMO_USERS.slice(0, 3).map(u => ({
      name: u.name,
      text: 'Doctor, entiendo su punto. Considerando el perfil de sus pacientes, la evidencia muestra un beneficio consistente en adherencia y control sintomático; ¿le parece si revisamos un caso concreto?',
    })),
  }))
  // Worst success rate first — how the real endpoint is consumed.
  data.sort((a, b) => a.passRate - b.passRate)
  return { data }
}

// ── LMS ───────────────────────────────────────────────────────────────────────
/**
 * LMS demo data. Deliberately NOT built from demoOverview(): an LMS measures
 * course progress (enrolled / completed / quiz score), not evaluation sessions.
 * Reusing the evaluation numbers here is exactly the Simulator-relabelled-as-LMS
 * problem this module exists to avoid.
 */
export function demoLms(from: Date, to: Date, lang: 'en' | 'es' = 'es') {
  const days = daysBetween(from, to)
  const rng  = seededRng(dateToSeed(from, to, solutionSalt('lms')) + 23)

  const COURSES = lang === 'en'
    ? [
        'Sales Induction',
        'Product: Cardiovascular Portfolio',
        'Medical Visit Techniques',
        'Pharma Compliance & Regulations',
        'Advanced Objection Handling',
      ]
    : [
        'Inducción Comercial',
        'Producto: Portafolio Cardiovascular',
        'Técnicas de Visita Médica',
        'Normativa y Compliance Farmacéutico',
        'Manejo de Objeciones Avanzado',
      ]

  // A real, shared roster size drives every course below -- reported directly
  // in the Aug 20/21 sprint reviews: "102 total users, 5 courses each, so
  // 510 total possible completions... the completion rate should be
  // compared not to the enrolled, but to the total." Previously each
  // course's `enrolled` was its own independent 20-64 roll, unconstrained by
  // any shared user count, so "how many of our N users are in this course"
  // never made sense across the table. Every course is now a real subset of
  // the SAME totalUsers roster, and both the per-course and aggregate
  // completionRate use the exact formula shipped in
  // lib/lms-learnworlds.ts's real fix (completed / totalUsers, and
  // completed / (totalUsers x totalCourses)), so the demo actually exercises
  // the corrected math instead of a shape the real formula never sees.
  const totalUsers = 40 + Math.floor(rng() * 60) // 40-100, a realistic roster
  const enrolledUsers = Math.round(totalUsers * (0.7 + rng() * 0.25)) // 70-95% enrolled in at least one course

  let totalEnrollments = 0
  let totalCompleted   = 0
  let scoreSum = 0
  let scoreN   = 0

  // Learner identities for the raw per-enrollment export below -- cycles the
  // real-sounding DEMO_USERS names, then numbered "Learner N" for the rest of
  // the roster (this roster, 40-100, is bigger than the 15-name list used
  // elsewhere for best-performers/objections).
  const learnerName = (idx: number) => idx < DEMO_USERS.length ? DEMO_USERS[idx].name : `Learner ${idx + 1}`
  const learnerEmail = (idx: number) => idx < DEMO_USERS.length ? DEMO_USERS[idx].email : `learner${idx + 1}@demo.rolplay.ai`

  const enrollments: {
    userId: string; userName: string; userEmail: string; courseId: string; courseName: string
    status: 'completed' | 'in_progress' | 'not_started'; score: number | null; completedAt: string | null
  }[] = []

  const courses = COURSES.map((name, i) => {
    const enrollRate = 0.45 + rng() * 0.5 // 45-95% of the roster took this course
    const enrolled   = Math.min(totalUsers, Math.round(totalUsers * enrollRate))
    const rate       = 0.42 + rng() * 0.45
    const completed  = Math.round(enrolled * rate)
    const inProgressN = Math.max(0, enrolled - completed - Math.round(enrolled * 0.2))
    const avgScore   = Math.round((74 + rng() * 16) * 10) / 10

    totalEnrollments += enrolled
    totalCompleted   += completed
    scoreSum += avgScore
    scoreN   += 1

    const courseId = `demo-course-${i + 1}`
    // One real enrollment row per learner in this course -- deterministic
    // "first N of the roster" rather than a random subset, so a viewer can
    // cross-check completed+inProgress+notStarted against the course's own
    // aggregate counts above by counting rows in the exported CSV.
    for (let u = 0; u < enrolled; u++) {
      const status: 'completed' | 'in_progress' | 'not_started' =
        u < completed ? 'completed' : u < completed + inProgressN ? 'in_progress' : 'not_started'
      const daysAgo = Math.floor(rng() * days)
      enrollments.push({
        userId: `demo-learner-${u + 1}`,
        userName: learnerName(u),
        userEmail: learnerEmail(u),
        courseId,
        courseName: name,
        status,
        score: status === 'completed' ? Math.max(0, Math.min(100, Math.round(avgScore + (rng() - 0.5) * 20))) : null,
        completedAt: status === 'completed' ? toYMD(addDays(to, -daysAgo)) : null,
      })
    }

    return {
      courseId,
      name,
      enrolled,
      completed,
      inProgress: inProgressN,
      totalUsers,
      // Against the full roster, not just this course's own enrollment --
      // matches lib/lms-learnworlds.ts's real completionRate formula exactly.
      completionRate: Math.round((completed / totalUsers) * 1000) / 10,
      avgScore,
    }
  })

  // Cursos finalizados por día is now a FIXED, always-current 30-day
  // window, independent of the selected date range -- matches the real fix
  // in lib/lms-learnworlds.ts's lmsDashboard exactly (that chart no longer
  // follows the global range either). Anchored to the real "today", not
  // `to`, so demo exercises the same "last 30 days from now" semantics a
  // real client sees rather than however wide "Todos" happens to be
  // (previously produced a chart spanning years for that selection).
  const TREND_WINDOW_DAYS = 30
  const trendEnd = new Date()
  const completionTrend = Array.from({ length: TREND_WINDOW_DAYS }, (_, d) => {
    const date = new Date(trendEnd)
    date.setDate(date.getDate() - (TREND_WINDOW_DAYS - 1 - d))
    return {
      date:  date.toISOString().slice(0, 10),
      value: Math.max(0, Math.round((totalCompleted / TREND_WINDOW_DAYS) * (0.5 + rng()))),
    }
  })

  const inProgress = courses.reduce((n, c) => n + c.inProgress, 0)

  return {
    configured:       true,
    enrolledUsers,
    totalUsers,
    totalEnrollments,
    totalCourses:     courses.length,
    modulesCompleted: totalCompleted,
    inProgress,
    notStarted:       Math.max(0, totalEnrollments - totalCompleted - inProgress),
    // Against the full roster (totalUsers x totalCourses), matching the real
    // fix in lib/lms-learnworlds.ts -- e.g. 102 users x 5 courses = 510
    // possible completions, not however many enrollments happened to exist.
    completionRate:   Math.round((totalCompleted / (totalUsers * courses.length)) * 1000) / 10,
    // Demo shows a graded school so the scored path is exercised too.
    avgQuizScore:     Math.round((scoreSum / scoreN) * 10) / 10,
    hasScoreData:     true,
    completionTrend,
    courses,
    // Internal/temporary: one row per (learner, course) enrollment -- lets an
    // admin export the raw data an LMS completion rate is actually built
    // from, the same way the other 3 modules' "Evaluation Results" export
    // does. Not part of LmsApiResponse's real-data contract (optional field,
    // real LearnWorlds responses never set it) -- to be removed once the
    // KPI-design evaluation this was requested for is done.
    enrollments,
  }
}
