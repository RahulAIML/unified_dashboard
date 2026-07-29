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
export function demoLms(from: Date, to: Date) {
  const days = daysBetween(from, to)
  const rng  = seededRng(dateToSeed(from, to, solutionSalt('lms')) + 23)

  const COURSES = [
    'Inducción Comercial',
    'Producto: Portafolio Cardiovascular',
    'Técnicas de Visita Médica',
    'Normativa y Compliance Farmacéutico',
    'Manejo de Objeciones Avanzado',
  ]

  const learners = 60 + Math.floor(rng() * 40)

  let totalEnrollments = 0
  let totalCompleted   = 0
  let scoreSum = 0
  let scoreN   = 0

  const courses = COURSES.map((name, i) => {
    const enrolled  = 20 + Math.floor(rng() * 45)
    const rate      = 0.42 + rng() * 0.45
    const completed = Math.round(enrolled * rate)
    const avgScore  = Math.round((74 + rng() * 16) * 10) / 10

    totalEnrollments += enrolled
    totalCompleted   += completed
    scoreSum += avgScore
    scoreN   += 1

    return {
      courseId: `demo-course-${i + 1}`,
      name,
      enrolled,
      completed,
      inProgress: Math.max(0, enrolled - completed - Math.round(enrolled * 0.2)),
      completionRate: Math.round((completed / enrolled) * 1000) / 10,
      avgScore,
    }
  })

  // Completions accrue over the selected window.
  const completionTrend = Array.from({ length: days }, (_, d) => {
    const date = new Date(from)
    date.setDate(date.getDate() + d)
    return {
      date:  date.toISOString().slice(0, 10),
      value: Math.max(0, Math.round((totalCompleted / days) * (0.5 + rng()))),
    }
  })

  const inProgress = courses.reduce((n, c) => n + c.inProgress, 0)

  return {
    configured:       true,
    enrolledUsers:    learners,
    totalUsers:       learners + 8,
    totalEnrollments,
    totalCourses:     courses.length,
    modulesCompleted: totalCompleted,
    inProgress,
    notStarted:       Math.max(0, totalEnrollments - totalCompleted - inProgress),
    completionRate:   Math.round((totalCompleted / totalEnrollments) * 1000) / 10,
    // Demo shows a graded school so the scored path is exercised too.
    avgQuizScore:     Math.round((scoreSum / scoreN) * 10) / 10,
    hasScoreData:     true,
    completionTrend,
    courses,
  }
}
