/**
 * Mock data structured to mirror real API responses.
 *
 * Architecture contract:
 *   - Every exported function accepts DateRange and returns a typed shape
 *   - To connect real data: replace the function body with a fetch() call
 *   - All KPI values, deltas, charts, and table rows react to the range
 *
 * Real SQL sources documented inline:
 *   coach_users, coach_usecases, coach_usecase_user,
 *   saved_reports (score, passed_flag, date_created),
 *   coach_evaluation_sessions, segment_contents (min_score),
 *   usecases, usecase_segment, segment_contents
 */

import type {
  GlobalOverviewData,
  CoachData,
  SimulatorData,
  CertificationData,
  SecondBrainData,
  LmsData,
  TimeSeriesPoint,
  DateRange,
} from './types'

// ─── deterministic helpers ────────────────────
// seeded() avoids SSR/client hydration mismatch (no Math.random at module level)

function seeded(seed: number): number {
  const x = Math.sin(seed + 1) * 10000
  return x - Math.floor(x)
}

/** Days between two dates, minimum 1 */
function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000))
}

/** Format a Date as YYYY-MM-DD without locale influence */
function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}

/**
 * Scale a baseline value proportionally to the selected period vs the 30-day baseline.
 * e.g. baseline=1342 over 7 days → ~313; over 90 days → ~4026
 */
function scaleByPeriod(baseline: number, days: number): number {
  return Math.round(baseline * days / 30)
}

/**
 * Compute a realistic delta (%) between current period and the equal prior period.
 * Uses seeded variation so the sign and magnitude are consistent across renders
 * but differ by the seed passed in.
 */
function computeDelta(seed: number, direction: 'positive' | 'negative' | 'neutral' = 'positive'): number {
  const magnitude = Math.round(2 + seeded(seed) * 28) // 2–30 %
  if (direction === 'positive') return magnitude
  if (direction === 'negative') return -magnitude
  // neutral: sometimes positive, sometimes negative
  return seeded(seed + 99) > 0.5 ? magnitude : -Math.round(1 + seeded(seed) * 8)
}

/**
 * Generate a daily time series for [range.from … range.to].
 * base     = average daily value
 * trend    = linear slope factor (positive → growing, 0 → flat)
 * variance = noise amplitude
 * seed     = series-specific seed to keep it distinct from other charts
 */
function dailySeries(
  range: DateRange,
  base: number,
  trend = 0,
  variance = 0.25,
  seed = 1
): TimeSeriesPoint[] {
  const days = daysBetween(range.from, range.to)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(range.from)
    d.setDate(d.getDate() + i)
    const trendBump = trend * i
    const noise     = (seeded(seed * 100 + i) - 0.5) * variance * base
    return {
      date:   fmt(d),
      value:  Math.max(0, Math.round(base + trendBump + noise)),
      value2: Math.max(0, Math.round((base * 0.35) + (seeded(seed * 100 + i + 50) - 0.5) * variance * base * 0.5)),
    }
  })
}

/** Build a pass/fail time series: value = passed, value2 = failed */
function passFailSeries(range: DateRange, dailyTotal: number, passRate: number): TimeSeriesPoint[] {
  const days = daysBetween(range.from, range.to)
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(range.from)
    d.setDate(d.getDate() + i)
    const total = Math.max(1, Math.round(dailyTotal * (0.6 + seeded(i * 7) * 0.8)))
    const pass  = Math.round(total * (passRate / 100) * (0.85 + seeded(i * 7 + 1) * 0.3))
    return {
      date:   fmt(d),
      value:  Math.min(pass, total),
      value2: total - Math.min(pass, total),
    }
  })
}

// ─── Global Overview ─────────────────────────────────────────────────────────
// Real sources: coach_users · coach_usecase_user · saved_reports · coach_teams

export function getGlobalOverviewData(range: DateRange): GlobalOverviewData {
  const days     = daysBetween(range.from, range.to)
  const sessions = scaleByPeriod(1_342, days)
  const certified = scaleByPeriod(94, days)
  // avg score drifts slightly per period — longer period = more stable avg
  const avgScore  = Math.round(72 + seeded(days) * 6)
  // pass rate varies per period
  const passRate  = Math.round(62 + seeded(days + 50) * 12)

  // module breakdown scales with period
  const coachSessions = scaleByPeriod(420, days)
  const simSessions   = scaleByPeriod(680, days)
  const certSessions  = scaleByPeriod(242, days)

  return {
    kpis: {
      // totalUsers / totalAssigned are cumulative (not period-based) — real API would not filter by date
      totalUsers:    { label: 'Total Users',            labelKey: 'totalUsers',          value: 248,       delta: computeDelta(1),  tier: 'A' },
      totalAssigned: { label: 'Assigned to Scenarios',  labelKey: 'assignedToScenarios', value: 186,       delta: computeDelta(2),  tier: 'A' },
      // activity metrics scale with period
      totalSessions: { label: 'Practice Sessions',      labelKey: 'practiceSessions',    value: sessions,  delta: computeDelta(3),  tier: 'A' },
      avgScore:      { label: 'Avg Session Score',      labelKey: 'avgSessionScore',     value: avgScore,  delta: computeDelta(4, 'neutral'),  unit: 'pts', tier: 'B' },
      passRate:      { label: 'Overall Pass Rate',      labelKey: 'overallPassRate',     value: passRate,  delta: computeDelta(5, 'negative'), unit: '%',   tier: 'B' },
      certifiedUsers:{ label: 'Certified Users',        labelKey: 'certifiedUsers',      value: certified, delta: computeDelta(6),  tier: 'A' },
    },

    // line chart: daily sessions across the range
    activityTrend: dailySeries(range, sessions / days, 0.1, 0.3, 1),

    // bar chart: sessions by module — scaled by range
    moduleBreakdown: [
      { module: 'Master Coach',    sessions: coachSessions, passed: Math.round(coachSessions * 0.74) },
      { module: 'Simulator',       sessions: simSessions,   passed: Math.round(simSessions   * 0.68) },
      { module: 'Certification',   sessions: certSessions,  passed: Math.round(certSessions  * 0.72) },
      { module: 'Second Brain',    sessions: 0,             passed: 0 },
      { module: 'LMS',             sessions: 0,             passed: 0 },
    ],

    // table: users with session counts scaled to the period
    userTable: Array.from({ length: 20 }, (_, i) => {
      // scale individual session count to selected period
      const baseSessions  = Math.floor(seeded(i * 7 + 1) * 30) + 1
      const periodSessions = scaleByPeriod(baseSessions, days)
      const score  = seeded(i * 7 + 2) > 0.15 ? Math.round(58 + seeded(i * 7 + 3) * 40) : null
      const pRate  = score !== null ? Math.round(48 + seeded(i * 7 + 4) * 50) : null
      return {
        id:   i + 1,
        name: ['Alice Chen','Bob Martinez','Clara Santos','David Kim','Elena Rossi',
               'Frank Müller','Grace Liu','Hiro Tanaka','Isabelle Roy','James Okafor',
               'Karen Novak','Leo Pereira','Mia Schmidt','Noah Dubois','Olivia Park',
               'Pedro Alves','Quinn Walsh','Rachel Sato','Sam Johansson','Tara Mehta'][i],
        email:            `user${i + 1}@client.com`,
        assignedUsecases: Math.floor(seeded(i * 7) * 5) + 1,
        sessions:         Math.max(1, periodSessions),
        avgScore:         score,
        passRate:         pRate,
        // joined date: fixed, irrelevant to period filter
        dateAdded: fmt(new Date(new Date('2026-04-03').setDate(new Date('2026-04-03').getDate() - Math.floor(seeded(i * 7 + 6) * 180)))),
      }
    }),
  }
}

// ─── Master Coach ─────────────────────────────────────────────────────────────
// Real sources: coach_usecases · coach_usecase_user · coach_teams · usecase_stages
//
// Note: configured use cases & teams are cumulative, not period-filtered.
// Only deployment trend reacts to the date range.

export function getCoachData(range: DateRange): CoachData {
  const days = daysBetween(range.from, range.to)
  // New use cases added in period
  const newUsecases = Math.max(1, scaleByPeriod(4, days))

  return {
    kpis: {
      // cumulative counts — real API: SELECT COUNT(*) FROM coach_usecases WHERE customer_id = ?
      configuredUsecases: { label: 'Configured Use Cases', labelKey: 'configuredUseCases', value: 12,  delta: computeDelta(11), tier: 'A' },
      assignedUsers:      { label: 'Assigned Users',       labelKey: 'assignedUsers',      value: 186, delta: computeDelta(12), tier: 'A' },
      activeTeams:        { label: 'Active Teams',         labelKey: 'activeTeams',        value: 7,   delta: computeDelta(13), tier: 'A' },
      knowledgeStages:    { label: 'Knowledge Stages',     labelKey: 'knowledgeStages',    value: 48,  delta: computeDelta(14), tier: 'A' },
    },

    // trend: cumulative use cases configured over the period
    deploymentTrend: Array.from({ length: days }, (_, i) => {
      const d = new Date(range.from)
      d.setDate(d.getDate() + i)
      // starts at (12 - newUsecases), grows to 12 over the period with small bumps
      const base  = Math.round((12 - newUsecases) + (newUsecases * i / days))
      const noise = Math.round(seeded(i * 5 + 11) * 1)
      return { date: fmt(d), value: Math.max(1, base + noise) }
    }),

    // table: static inventory — real API would filter by customer_id only
    usecaseTable: [
      { id: 1,  name: 'Sales Discovery Call',        assignedUsers: 42, stages: 4, dateCreated: '2025-10-04', interactionType: 'Realtime' },
      { id: 2,  name: 'Objection Handling',          assignedUsers: 38, stages: 3, dateCreated: '2025-10-19', interactionType: 'Realtime' },
      { id: 3,  name: 'Cold Outreach Practice',      assignedUsers: 31, stages: 3, dateCreated: '2025-11-03', interactionType: 'Audio'    },
      { id: 4,  name: 'Product Demo Coaching',       assignedUsers: 28, stages: 5, dateCreated: '2025-11-08', interactionType: 'Video'    },
      { id: 5,  name: 'Executive Presentation',      assignedUsers: 22, stages: 4, dateCreated: '2025-11-18', interactionType: 'Realtime' },
      { id: 6,  name: 'Negotiation Masterclass',     assignedUsers: 18, stages: 6, dateCreated: '2025-11-23', interactionType: 'Realtime' },
      { id: 7,  name: 'Customer Success Onboarding', assignedUsers: 15, stages: 3, dateCreated: '2025-11-28', interactionType: 'Audio'    },
      { id: 8,  name: 'Technical Sales Pitch',       assignedUsers: 14, stages: 4, dateCreated: '2025-12-03', interactionType: 'Video'    },
      { id: 9,  name: 'Stakeholder Management',      assignedUsers: 12, stages: 3, dateCreated: '2025-12-13', interactionType: 'Realtime' },
      { id: 10, name: 'Enterprise Account Review',   assignedUsers: 9,  stages: 4, dateCreated: '2025-12-18', interactionType: 'Realtime' },
      { id: 11, name: 'Channel Partner Enablement',  assignedUsers: 7,  stages: 3, dateCreated: '2025-12-23', interactionType: 'Audio'    },
      { id: 12, name: 'MEDDIC Qualification',        assignedUsers: 5,  stages: 5, dateCreated: '2025-12-28', interactionType: 'Realtime' },
    ],
  }
}

// ─── Practice Simulator ───────────────────────────────────────────────────────
// Real sources: saved_reports (score, passed_flag, date_created)
//               coach_usecases · coach_usecase_user
//
// Distinction from Certification: WHERE eval_session_id IS NULL

export function getSimulatorData(range: DateRange): SimulatorData {
  const days     = daysBetween(range.from, range.to)
  const sessions = scaleByPeriod(1_342, days)
  // avg score trends upward over longer periods (more practice → better)
  const avgScore = Math.round(68 + seeded(days * 3) * 10)
  const passRate = Math.round(60 + seeded(days * 3 + 1) * 15)

  const scenarios = [
    'Cold Call Opener',    'Discovery Deep Dive', 'Demo Delivery',    'Objection Crusher',
    'Closing Sequence',    'Follow-up Email',     'Executive Pitch',  'Competitive Battle',
  ]

  return {
    kpis: {
      configuredScenarios: { label: 'Configured Scenarios', labelKey: 'configuredScenarios', value: 8,        delta: computeDelta(21),             tier: 'A' },
      assignedUsers:       { label: 'Assigned Users',       labelKey: 'assignedUsers',       value: 162,      delta: computeDelta(22),             tier: 'A' },
      totalSessions:       { label: 'Total Sessions',       labelKey: 'totalSessions',       value: sessions, delta: computeDelta(23),             tier: 'B' },
      avgScore:            { label: 'Avg Score',            labelKey: 'avgScore',            value: avgScore, delta: computeDelta(24, 'positive'), unit: 'pts', tier: 'B' },
    },

    // score trend: improving curve across the selected range
    scoreTrend: Array.from({ length: days }, (_, i) => {
      const d = new Date(range.from)
      d.setDate(d.getDate() + i)
      const base  = 62 + (12 * i / days) // rises from 62 → 74 over the period
      const noise = (seeded(i * 4 + 21) - 0.5) * 12
      return { date: fmt(d), value: Math.round(Math.max(50, Math.min(95, base + noise))) }
    }),

    // table: per-scenario breakdown — sessions scale with period
    scenarioTable: scenarios.map((name, i) => ({
      id:           i + 1,
      name,
      assignedUsers: Math.floor(20 + seeded(i * 6) * 100),
      sessions:      Math.max(1, scaleByPeriod(Math.floor(50 + seeded(i * 6 + 1) * 300), days)),
      avgScore:      Math.round(55 + seeded(i * 6 + 2) * 35),
      passRate:      Math.round(passRate - 10 + seeded(i * 6 + 3) * 20),
      lastActivity:  fmt(new Date(range.to.getTime() - Math.floor(seeded(i * 6 + 4) * days * 0.5) * 86_400_000)),
    })),
  }
}

// ─── Expert Certification ─────────────────────────────────────────────────────
// Real sources: saved_reports (eval_session_id IS NOT NULL, score, passed_flag, date_created)
//               coach_evaluation_sessions · usecase_segment · segment_contents (min_score)

export function getCertificationData(range: DateRange): CertificationData {
  const days       = daysBetween(range.from, range.to)
  const candidates = scaleByPeriod(94, days)
  const passRate   = Math.round(64 + seeded(days + 30) * 10)
  const avgScore   = Math.round(70 + seeded(days + 31) * 8)
  const pending    = Math.max(2, scaleByPeriod(12, days))

  const names = [
    'Alice Chen','Bob Martinez','Clara Santos','David Kim','Elena Rossi',
    'Frank Müller','Grace Liu','Hiro Tanaka','Isabelle Roy','James Okafor',
    'Karen Novak','Leo Pereira','Mia Schmidt','Noah Dubois','Olivia Park',
    'Pedro Alves','Quinn Walsh','Rachel Sato','Sam Johansson','Tara Mehta',
  ]
  const segments = ['Sales Discovery','Objection Handling','Demo Delivery','Negotiation','Closing']

  // number of result rows scales with period (more days → more evaluations visible)
  const rowCount = Math.min(30, Math.max(5, scaleByPeriod(30, days)))

  return {
    kpis: {
      candidates: { label: 'Candidates Evaluated', labelKey: 'candidatesEvaluated',  value: candidates, delta: computeDelta(31),             tier: 'A' },
      passRate:   { label: 'Pass Rate',             labelKey: 'passRate',            value: passRate,  delta: computeDelta(32, 'negative'), unit: '%',   tier: 'B' },
      avgScore:   { label: 'Avg Score',             labelKey: 'avgScore',            value: avgScore,  delta: computeDelta(33, 'positive'), unit: 'pts', tier: 'B' },
      pending:    { label: 'Pending Evaluations',   labelKey: 'pendingEvaluations',  value: pending,   delta: 0,                            tier: 'B' },
    },

    // stacked bar: pass vs fail per day, scaled to period
    passFail: passFailSeries(range, Math.ceil(candidates / days), passRate),

    // results table: rows filtered to the selected period
    resultsTable: Array.from({ length: rowCount }, (_, i) => {
      const score = Math.round(50 + seeded(i * 8 + 30) * 45)
      // distribute result dates across the range
      const daysOffset = Math.floor(seeded(i * 8 + 31) * days)
      const resultDate = new Date(range.from)
      resultDate.setDate(resultDate.getDate() + daysOffset)
      return {
        userId:   i + 1,
        userName: names[i % names.length],
        segment:  segments[i % segments.length],
        score,
        passed:   score >= 70,
        date:     fmt(resultDate),
      }
    }),
  }
}

// ─── Second Brain ─────────────────────────────────────────────────────────────
// Real sources: segment_contents (file, content_from, date_created)
//               usecase_segment · coach_usecases
//
// Note: document counts are cumulative. Upload trend reacts to the period.

export function getSecondBrainData(range: DateRange): SecondBrainData {
  const days         = daysBetween(range.from, range.to)
  // new docs uploaded in the period
  const newDocs      = scaleByPeriod(28, days)
  const totalDocs    = 87  // cumulative — doesn't shrink with shorter range
  const totalSegments = 143

  const fileTypes = ['pdf','docx','pptx','xlsx','txt','mp4']
  const usecases  = [
    'Sales Discovery Call','Objection Handling','Product Demo Coaching',
    'Negotiation Masterclass','MEDDIC Qualification',
  ]

  return {
    kpis: {
      // cumulative counts — real API: SELECT COUNT(*) FROM segment_contents
      totalDocs:            { label: 'Knowledge Documents',      labelKey: 'knowledgeDocuments',    value: totalDocs,     delta: computeDelta(41), tier: 'A' },
      fileTypes:            { label: 'File Types Indexed',       labelKey: 'fileTypesIndexed',      value: 6,             delta: 0,               tier: 'A' },
      totalSegments:        { label: 'Content Segments',         labelKey: 'contentSegments',       value: totalSegments, delta: computeDelta(42), tier: 'A' },
      // period metric: avg segments across use cases in view
      avgSegmentsPerUsecase:{ label: 'Avg Segments / Use Case',  labelKey: 'avgSegmentsPerUsecase', value: Math.round(totalSegments / 12), delta: computeDelta(43), tier: 'B' },
    },

    // upload trend: docs added per day in the period
    uploadTrend: Array.from({ length: days }, (_, i) => {
      const d = new Date(range.from)
      d.setDate(d.getDate() + i)
      return {
        date:  fmt(d),
        value: Math.max(0, Math.round((newDocs / days) * (0.4 + seeded(i * 3 + 40) * 1.2))),
      }
    }),

    // table: filter to docs added within the range (simulate with date comparison)
    docTable: Array.from({ length: 20 }, (_, i) => {
      // each doc has a fixed "upload date" based on its seed
      const addedDaysAgo = Math.floor(seeded(i * 9) * 90)  // 0–89 days ago from today
      const addedDate = new Date('2026-04-03')
      addedDate.setDate(addedDate.getDate() - addedDaysAgo)
      const addedStr = fmt(addedDate)
      return {
        id:          i + 1,
        name:        `Document_${String(i + 1).padStart(3, '0')}`,
        type:        fileTypes[i % fileTypes.length],
        usecaseName: usecases[i % usecases.length],
        dateAdded:   addedStr,
        segmentCount:Math.floor(2 + seeded(i * 9 + 1) * 10),
        // flag for UI to grey out docs outside range
        inRange: addedDate >= range.from && addedDate <= range.to,
      }
    }).filter(d => d.inRange || days >= 90),  // 90d shows all; shorter ranges filter
  }
}

// ─── LMS ─────────────────────────────────────────────────────────────────────
// Blocked: LMS data lives in the rolplay.pro database (separate schema).
// Schema audit required before any real queries can be written.

export function getLmsData(_range?: DateRange): LmsData {
  return {
    kpis: {
      enrolledUsers:    { label: 'Enrolled Users',    labelKey: 'enrolledUsers',    value: '—', delta: 0, tier: 'B' },
      completionRate:   { label: 'Completion Rate',   labelKey: 'completionRate',   value: '—', delta: 0, unit: '%',  tier: 'B' },
      avgQuizScore:     { label: 'Avg Quiz Score',    labelKey: 'avgQuizScore',     value: '—', delta: 0, unit: 'pts',tier: 'B' },
      modulesCompleted: { label: 'Modules Completed', labelKey: 'modulesCompleted', value: '—', delta: 0, tier: 'B' },
    },
    completionTrend: [],
    moduleTable: [],
  }
}
