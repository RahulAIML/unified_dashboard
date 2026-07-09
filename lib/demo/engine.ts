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

// ── Demo constants ────────────────────────────────────────────────────────────
export const DEMO_USECASE_IDS = [101, 102, 103, 104, 105] as const

export const DEMO_USECASES: Record<number, string> = {
  101: 'Discovery Call Mastery',
  102: 'Objection Handling Pro',
  103: 'Product Demo Excellence',
  104: 'Negotiation Techniques',
  105: 'Technical Deep Dive',
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

// ── Overview KPIs ─────────────────────────────────────────────────────────────
export function demoOverview(from: Date, to: Date, solution: string | null = null) {
  const days = daysBetween(from, to)
  const salt = solutionSalt(solution)
  const rng  = seededRng(dateToSeed(from, to, salt))

  // Solution-specific base rates
  const rateMap: Record<string, number> = {
    'lms': 75, 'coach': 102, 'simulator': 88, 'certification': 65, 'second-brain': 0,
  }
  const baseRate = rateMap[solution || ''] || 94
  const dailyRate   = baseRate + rng() * 15
  const totalEvals  = Math.round(dailyRate * days)

  // Solution-specific score ranges
  const scoreMap: Record<string, [number, number]> = {
    'lms': [78, 4], 'coach': [84, 5], 'simulator': [81, 6], 'certification': [82, 4],
  }
  const [scoreBase, scoreVar] = scoreMap[solution || ''] || [83, 4]
  const avgScore    = Math.round((scoreBase + rng() * scoreVar) * 10) / 10

  // Solution-specific pass rates
  const passMap: Record<string, [number, number]> = {
    'lms': [72, 8], 'coach': [76, 6], 'simulator': [79, 5], 'certification': [81, 4],
  }
  const [passBase, passVar] = passMap[solution || ''] || [74, 7]
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
export function demoTrends(from: Date, to: Date, solution: string | null = null) {
  const days = daysBetween(from, to)
  const salt = solutionSalt(solution)
  const rng  = seededRng(dateToSeed(from, to, salt) + 7)

  const scoreTrend:     { date: string; value: number }[]                   = []
  const passFailTrend:  { date: string; value: number; value2: number }[]   = []
  const evalCountTrend: { date: string; value: number }[]                   = []

  for (let i = 0; i < days; i++) {
    const d   = addDays(from, i)
    const ymd = toYMD(d)

    // Smooth upward score trend: starts ~81, ends ~87
    const progress = days > 1 ? i / (days - 1) : 1
    const baseScore = 81 + progress * 6
    const jitter    = (rng() - 0.5) * 4
    scoreTrend.push({ date: ymd, value: Math.round((baseScore + jitter) * 10) / 10 })

    // Eval count: weekday peaks (Mon-Fri higher)
    const dow    = d.getDay()
    const isWeek = dow > 0 && dow < 6
    const base   = isWeek ? 80 + rng() * 40 : 20 + rng() * 20
    const evals  = Math.round(base)
    evalCountTrend.push({ date: ymd, value: evals })

    // Pass/fail derived from evals and a ~78% pass rate
    const passRate = 0.73 + progress * 0.08 + (rng() - 0.5) * 0.06
    const passed   = Math.round(evals * Math.min(0.95, Math.max(0.55, passRate)))
    const failed   = evals - passed
    passFailTrend.push({ date: ymd, value: passed, value2: failed })
  }

  return { scoreTrend, passFailTrend, evalCountTrend }
}

// ── Usecase Breakdown ─────────────────────────────────────────────────────────
export function demoUsecaseBreakdown(from: Date, to: Date, solution: string | null) {
  const days      = daysBetween(from, to)
  const salt      = solutionSalt(solution)
  const rng       = seededRng(dateToSeed(from, to, salt) + 13)
  const totalBase = Math.round(90 * days)

  // Distribution weights (must sum to ~1)
  const weights = [0.28, 0.24, 0.22, 0.15, 0.11]

  const ids = solution
    ? [DEMO_USECASE_IDS.find(
        (_, i) => ['lms','coach','simulator','certification',''].includes(solution) || i === 0
      ) ?? 101]
    : [...DEMO_USECASE_IDS]

  const rows = ids.map((ucId, i) => {
    const weight = weights[i] ?? 0.2
    const total  = Math.round(totalBase * weight * (0.9 + rng() * 0.2))
    const score  = Math.round((78 + rng() * 12) * 10) / 10
    const pr     = Math.round((70 + rng() * 18) * 10) / 10
    const passed = Math.round(total * (pr / 100))

    return {
      usecaseId:        ucId,
      usecase_name:     DEMO_USECASES[ucId] ?? `Scenario ${ucId}`,
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

  return {
    data: DEMO_USERS.slice(0, limit).map(u => ({
      user_email: u.email,
      user_name:  u.name,
      sessions:   Math.round(days * (0.8 + rng() * 1.2)),
      avg_score:  Math.round((85 + rng() * 12) * 10) / 10,
      pass_rate:  Math.round((79 + rng() * 17) * 10) / 10,
    })),
  }
}

// ── Access Status ─────────────────────────────────────────────────────────────
export function demoAccessStatus() {
  return {
    hasCoachData:       true,
    hasSecondBrainData: true,
    hasBancoAccess:     false,
    hasPharmaAccess:    false,
    hasAnyAccess:       true,
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
