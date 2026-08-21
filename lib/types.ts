// ─────────────────────────────────────────────
//  Standard API contract types
// ─────────────────────────────────────────────

export interface ApiMeta {
  filters:   Record<string, unknown>
  timestamp: string
  source:    "db"
}

/**
 * Every API route returns this wrapper.
 * The useApi hook auto-unwraps .data so pages receive T directly.
 */
export interface ApiResponse<T> {
  success: boolean
  data:    T
  meta:    ApiMeta
}

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
  /** True when there is no real previous-period value to compare against
   *  (e.g. a current-state snapshot with no date range) — renders a neutral
   *  "no comparison" badge instead of a real-looking "+0%" delta. */
  noComparison?: boolean
  /** Visible caption under the value, e.g. "Pass threshold: score >= 80 pts"
   *  (see OverviewApiResponse.passRateLegend) — so an applied criterion is
   *  never left for the viewer to infer. Absent for every KPI this doesn't
   *  apply to. */
  legend?: string | null
  /** Definition + formula shown via the info/"eye" affordance next to the
   *  label, on hover or click. Absent = no affordance for this tile. */
  info?: string
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
  /**
   * The exact legend text for the pass-rate section (e.g. "Pass threshold:
   * score >= 80 pts"), so the applied criteria are never left for the
   * viewer to infer -- see lib/kpi-builder.ts's passRateLegend(). null means
   * this tenant has no applicable passing criteria at all: the frontend
   * must hide the pass-rate section entirely rather than show a misleading
   * number. undefined (absent) means this org type hasn't been wired up to
   * report it yet -- render exactly as before this field existed.
   */
  passRateLegend?: string | null
}

/** A single point in a time-series returned by GET /api/dashboard/trends */
export interface ApiTrendPoint {
  date:    string   // YYYY-MM-DD
  value:   number
  value2?: number
}

/** Response from GET /api/dashboard/trends */
export interface ScoreDistributionBucket {
  range: string // e.g. "70-79"
  count: number
  pct:   number
}

export interface TrendsApiResponse {
  scoreTrend:     ApiTrendPoint[]
  passFailTrend:  ApiTrendPoint[]
  evalCountTrend: ApiTrendPoint[]
  /** Only present for tenants where score-distribution buckets can be computed from raw session rows. */
  scoreDistribution?: ScoreDistributionBucket[]
}

/** A single row from GET /api/dashboard/results */
export interface EvaluationApiRow {
  savedReportId: number
  usecaseId:     number | null
  usecaseName:   string | null
  score:         number | null
  result:        string | null
  // null (not false) when score is null -- a session with no extractable
  // score at all has no real pass/fail verdict, and `false` would render as
  // a fabricated "FAIL" badge next to a blank score. Mirrors `result`, which
  // already carries this same null-for-unscoreable rule.
  passed:        boolean | null
  date:          string
}

/** Response from GET /api/dashboard/results */
export interface ResultsApiResponse {
  data: EvaluationApiRow[]
}

/** A single row from GET /api/dashboard/usecase-breakdown */
export interface UsecaseApiRow {
  usecaseId:        number
  usecase_name:     string | null   // real display name — source varies by org type (coach_app.usecases, activities.demorp6, kpi.activity_summary, ...)
  totalEvaluations: number
  avgScore:         number | null
  passRate:         number | null
  passed:           number
}

/** Response from GET /api/dashboard/usecase-breakdown */
export interface UsecaseBreakdownApiResponse {
  data: UsecaseApiRow[]
}

// ── Best Performers ─────────────────────────────

export interface BestPerformerRow {
  user_email:  string
  user_name:   string | null   // coach_app.coach_users.user_name (single column)
  sessions:    number
  avg_score:   number
  pass_rate:   number
}

export interface BestPerformersApiResponse {
  data: BestPerformerRow[]
  /** All-time (not date-filtered) aggregate — only present for tenants with a real source for it (e.g. Sanfer's sim.topstats). */
  allTimeStats?: {
    totalRecords:  number
    avgBestScore:  number
    recordsGe80:   number
    uniqueUsers:   number
    uniqueSims:    number
  }
}

// ── Objections (pharma-sim tenants with a real objection-handling data source) ──

export interface ObjectionRow {
  usecaseId:     number
  objectionText: string
  count:         number
  passRate:      number
  modelAnswer:   string | null
  topAnswers:    { text: string; name: string }[]
}

export interface ObjectionsApiResponse {
  data: ObjectionRow[]
}

// ── Business Lines (pharma-sim tenants with a real line/tag catalog) ──────────

export interface BusinessLineRow {
  tagId:        number
  name:         string
  memberCount:  number
  simCount:     number
  avgScore:     number | null
  activeUsers:  number
}

export interface BusinessLinesApiResponse {
  data: BusinessLineRow[]
}

// ── Organization (pharma-sim tenants with a real members/admins source) ──────

export interface OrgMemberRow {
  id:          number
  fullName:    string
  email:       string
  designation: string | null
  adminId:     number | null
}

export interface OrgAdminRow {
  id:          number
  fullName:    string
  email:       string
  profileType: string
}

export interface OrganizationApiResponse {
  totalMembers:    number
  totalAdmins:     number
  totalSupervisors: number
  members: OrgMemberRow[]
  admins:  OrgAdminRow[]
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

/* ---------------------------------------------------------------------------
 * LMS (LearnWorlds) — real API contract for GET /api/dashboard/lms
 *
 * Distinct from LmsData above (which carries KpiCard objects for the mock
 * layer). An LMS measures course progress — enrolled / completed / quiz score
 * — NOT evaluation sessions. Keeping this contract separate from
 * OverviewApiResponse is what stops Simulator numbers being relabelled as LMS.
 * Nullable metrics mean "no data upstream", never zero.
 * ------------------------------------------------------------------------- */

export interface LmsCourseRow {
  courseId:       string
  name:           string
  enrolled:       number
  completed:      number
  inProgress:     number
  /** Total real users on the school -- the completion-rate denominator (every
   *  user is expected to take every course), also shown as a "Total" column
   *  so the table matches the KPI tile's own "of N users" sub-label. */
  totalUsers:     number
  /** Percent 0-100, against totalUsers (the whole roster), not `enrolled`. */
  completionRate: number | null
  avgScore:       number | null
}

export interface LmsApiResponse {
  /** False when this tenant has no LMS configured — UI must show an empty state. */
  configured:       boolean
  /** Learners with at least one course enrollment (current state). */
  enrolledUsers:    number
  /** All users on the school, enrolled or not. */
  totalUsers:       number
  /** Enrollments = user x course pairs, across every status. */
  totalEnrollments: number
  totalCourses:     number
  modulesCompleted: number
  inProgress:       number
  notStarted:       number
  /** Percent 0-100, against the FULL roster (totalUsers * totalCourses),
   *  not against however many enrollments happened to exist -- every user
   *  is expected to take every course. Null when there's nothing to divide by. */
  completionRate:   number | null
  /**
   * Percent 0-100, or null when the school has no graded assessments.
   * LearnWorlds returns average_score_rate = 0 for ungraded courses, which is
   * indistinguishable from a real zero — so only positive values are averaged
   * and `hasScoreData` says whether any grade exists. Rendering a flat 0 would
   * misreport "never graded" as "everyone failed".
   */
  avgQuizScore:     number | null
  hasScoreData:     boolean
  /** Completions per day, filtered to the selected range. */
  completionTrend:  ApiTrendPoint[]
  courses:          LmsCourseRow[]
}
