// ─────────────────────────────────────────────
//  Core domain types — mirrored from DB schema
// ─────────────────────────────────────────────

export type Module = 'lms' | 'coach' | 'simulator' | 'certification' | 'second-brain'

export interface DateRange {
  from: Date
  to: Date
}

export interface DashboardFilters {
  selectedModules: Module[]
  dateRange: DateRange
  customerId?: number
}

// ─────────────────────────────────────────────
//  API response shapes (mock → real swap-in)
// ─────────────────────────────────────────────

import type { TranslationKey } from './translations'

export interface KpiCard {
  label: string          // English fallback (used as React key)
  labelKey: TranslationKey  // i18n key → translations[lang][labelKey]
  value: number | string
  delta: number          // % change vs prior period
  unit?: string          // '%', 'pts', etc.
  tier: 'A' | 'B'
}

export interface TimeSeriesPoint {
  date: string         // YYYY-MM-DD
  value: number
  value2?: number      // for stacked / comparison
}

export interface GlobalOverviewData {
  kpis: {
    totalUsers: KpiCard
    totalAssigned: KpiCard
    totalSessions: KpiCard
    avgScore: KpiCard
    passRate: KpiCard
    certifiedUsers: KpiCard
  }
  activityTrend: TimeSeriesPoint[]
  moduleBreakdown: { module: string; sessions: number; passed: number }[]
  userTable: UserRow[]
}

export interface UserRow {
  id: number
  name: string
  email: string
  assignedUsecases: number
  sessions: number
  avgScore: number | null
  passRate: number | null
  dateAdded: string
}

// ── Master Coach ─────────────────────────────

export interface CoachData {
  kpis: {
    configuredUsecases: KpiCard
    assignedUsers: KpiCard
    activeTeams: KpiCard
    knowledgeStages: KpiCard
  }
  deploymentTrend: TimeSeriesPoint[]
  usecaseTable: CoachUsecaseRow[]
}

export interface CoachUsecaseRow {
  id: number
  name: string
  assignedUsers: number
  stages: number
  dateCreated: string
  interactionType: string
}

// ── Practice Simulator ───────────────────────

export interface SimulatorData {
  kpis: {
    configuredScenarios: KpiCard
    assignedUsers: KpiCard
    totalSessions: KpiCard
    avgScore: KpiCard
  }
  scoreTrend: TimeSeriesPoint[]
  scenarioTable: ScenarioRow[]
}

export interface ScenarioRow {
  id: number
  name: string
  assignedUsers: number
  sessions: number
  avgScore: number | null
  passRate: number | null
  lastActivity: string | null
}

// ── Expert Certification ─────────────────────

export interface CertificationData {
  kpis: {
    candidates: KpiCard
    passRate: KpiCard
    avgScore: KpiCard
    pending: KpiCard
  }
  passFail: TimeSeriesPoint[]          // value=pass, value2=fail
  resultsTable: CertResultRow[]
}

export interface CertResultRow {
  userId: number
  userName: string
  segment: string
  score: number
  passed: boolean
  date: string
}

// ── Second Brain ─────────────────────────────

export interface SecondBrainData {
  kpis: {
    totalDocs: KpiCard
    fileTypes: KpiCard
    totalSegments: KpiCard
    avgSegmentsPerUsecase: KpiCard
  }
  uploadTrend: TimeSeriesPoint[]
  docTable: DocRow[]
}

export interface DocRow {
  id: number
  name: string
  type: string
  usecaseName: string
  dateAdded: string
  segmentCount: number
  inRange?: boolean
}

// ─────────────────────────────────────────────
//  Real API response types (from rolplay_pro_analytics)
// ─────────────────────────────────────────────

/** Response from GET /api/dashboard/overview */
export interface OverviewApiResponse {
  totalEvaluations:     number
  avgScore:             number | null
  passRate:             number | null
  passedEvaluations:    number
  prevTotalEvaluations: number
  prevAvgScore:         number | null
  prevPassRate:         number | null
}

/** A single point in a time-series returned by GET /api/dashboard/trends */
export interface ApiTrendPoint {
  date:    string   // YYYY-MM-DD
  value:   number
  value2?: number
}

/** Response from GET /api/dashboard/trends */
export interface TrendsApiResponse {
  scoreTrend:     ApiTrendPoint[]
  passFailTrend:  ApiTrendPoint[]
  evalCountTrend: ApiTrendPoint[]
}

/** A single row from GET /api/dashboard/results */
export interface EvaluationApiRow {
  savedReportId: number
  usecaseId:     number | null
  score:         number | null
  result:        string | null
  passed:        boolean
  date:          string
}

/** Response from GET /api/dashboard/results */
export interface ResultsApiResponse {
  data: EvaluationApiRow[]
}

/** A single row from GET /api/dashboard/usecase-breakdown */
export interface UsecaseApiRow {
  usecaseId:        number
  totalEvaluations: number
  avgScore:         number | null
  passRate:         number | null
  passed:           number
}

/** Response from GET /api/dashboard/usecase-breakdown */
export interface UsecaseBreakdownApiResponse {
  data: UsecaseApiRow[]
}

// ── LMS (limited data — placeholder) ─────────

export interface LmsData {
  kpis: {
    enrolledUsers: KpiCard
    completionRate: KpiCard
    avgQuizScore: KpiCard
    modulesCompleted: KpiCard
  }
  completionTrend: TimeSeriesPoint[]
  moduleTable: LmsModuleRow[]
}

export interface LmsModuleRow {
  id: number
  name: string
  enrolled: number
  completed: number
  avgScore: number | null
}
