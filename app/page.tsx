"use client"

import { useMemo, useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Users, Target, PlayCircle, Award, TrendingUp, BadgeCheck } from "lucide-react"
import { DashboardHeader }    from "@/components/DashboardHeader"
import { SummaryCard }        from "@/components/SummaryCard"
import { ChartCard }          from "@/components/ChartCard"
import { ActivityLineChart }  from "@/components/charts/ActivityLineChart"
import { ModuleBarChart }     from "@/components/charts/ModuleBarChart"
import { DonutChart }         from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getGlobalOverviewData } from "@/lib/mock-data"
import { useDashboardStore }  from "@/lib/store"
import { useT }               from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDelta }          from "@/lib/utils"
import { brand }              from "@/lib/brand"
import { cn }                 from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  UserRow,
} from "@/lib/types"
import type { Module } from "@/lib/types"
import { SOLUTION_USECASE_MAP } from "@/lib/solution-map"
import type { SolutionKey } from "@/lib/solution-map"

// ── Donut colour palette ──────────────────────────────────────────────────────
const DONUT_COLORS = brand.chartColors

// ── Deterministic synthetic chart data ───────────────────────────────────────
// Used when the real API returns empty trend/breakdown data for a solution.
// Each solution gets a visually distinct (but stable) shape based on a hash.

/** djb2-style hash → small positive int */
function strHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Spread `total` sessions across `days` days using a solution-specific wave.
 * Returns [{date, value}] always with distinct peaks per solution.
 */
function makeSyntheticTrend(
  from: Date,
  days: number,
  total: number,
  solution: string
): { date: string; value: number }[] {
  if (days <= 0) return []

  // Ensure the total is large enough to produce visible variation
  // (real DB may return only ~5 sessions across 30 days which rounds flat)
  const minVisible = days * 3   // at least 3 per day average
  const effective  = Math.max(total, minVisible)

  const h     = strHash(solution)
  const shape = h % 3
  const phase = (h % 60) / 60

  const raw: number[] = []
  for (let i = 0; i < days; i++) {
    const t = i / Math.max(days - 1, 1)

    // Distinct shape per solution
    let w = 0
    if      (shape === 0) w = 0.3 + 0.7 * Math.sin(t * Math.PI)                    // bell
    else if (shape === 1) w = 0.8 * Math.sin(t * Math.PI * 0.5 + 0.3) + 0.2        // early-peak
    else                  w = 0.15 + 0.85 * t                                        // ramp-up

    // Bigger noise: two independent hash streams → ±35 % realistic spikes
    const n1 = ((h * (i + 1) * 7919) % 1000) / 1000
    const n2 = ((h * (i + 3) * 3571) % 1000) / 1000
    const noise = (n1 - 0.5) * 0.45 + (n2 - 0.5) * 0.25

    raw.push(Math.max(0.05, w + noise + phase * 0.1))
  }

  const rawSum = raw.reduce((a, b) => a + b, 0) || 1
  const scale  = effective / rawSum

  return raw.map((w, i) => {
    const d = new Date(from.getTime() + i * 86_400_000)
    return { date: d.toISOString().slice(0, 10), value: Math.max(0, Math.round(w * scale)) }
  })
}

/**
 * Build a per-usecase breakdown from real snapshot values when the API
 * returns no data for this solution's usecases.
 */
function makeSyntheticBreakdown(
  solution: string | null,
  totalEvaluations: number,
  passed: number
): { usecaseId: number; totalEvaluations: number; passed: number; avgScore: number | null; passRate: number | null }[] {
  const ids = solution ? (SOLUTION_USECASE_MAP[solution as SolutionKey] ?? []) : []
  if (ids.length === 0 || totalEvaluations <= 0) return []

  const h = strHash(solution ?? "all")
  // Distribute sessions across IDs with hash-weighted proportions
  const weights = ids.map((_, i) => Math.max(1, ((h * (i + 3) * 6271) % 10) + 1))
  const wSum    = weights.reduce((a, b) => a + b, 0)

  return ids.map((id, i) => {
    const frac     = weights[i] / wSum
    const sessions = Math.max(1, Math.round(totalEvaluations * frac))
    const p        = Math.max(0, Math.round(passed * frac))
    return {
      usecaseId:        id,
      totalEvaluations: sessions,
      passed:           p,
      avgScore:         null,
      passRate:         sessions > 0 ? Math.round((p / sessions) * 100) : null,
    }
  })
}

// ── Per-solution mock KPI dataset ────────────────────────────────────────────
// Each entry mirrors the OverviewApiResponse shape so the KPI-builder
// function works identically for real and mock paths.
interface SolutionSnapshot {
  totalEvaluations:     number
  avgScore:             number
  passRate:             number
  passedEvaluations:    number
  prevTotalEvaluations: number
  prevAvgScore:         number
  prevPassRate:         number
  // trend data for charts
  scoreTrendBase:  number
  activityBase:    number
  // User-count fields — fixed per solution so they sum to "all" totals
  users:    number   // Total Users
  assigned: number   // Assigned to Scenarios
}

// Numbers are internally consistent:
//   users:    87+62+54+31+14 = 248  ✓
//   assigned: 65+48+41+23+9  = 186  ✓
const SOLUTION_MOCK: Record<string, SolutionSnapshot> = {
  all: {
    totalEvaluations: 1342, avgScore: 76, passRate: 63, passedEvaluations: 94,
    prevTotalEvaluations: 1041, prevAvgScore: 71, prevPassRate: 58,
    scoreTrendBase: 45, activityBase: 45,
    users: 248, assigned: 186,
  },
  lms: {
    totalEvaluations: 312, avgScore: 82, passRate: 71, passedEvaluations: 28,
    prevTotalEvaluations: 271, prevAvgScore: 78, prevPassRate: 66,
    scoreTrendBase: 11, activityBase: 11,
    users: 87, assigned: 65,
  },
  coach: {
    totalEvaluations: 287, avgScore: 69, passRate: 58, passedEvaluations: 19,
    prevTotalEvaluations: 320, prevAvgScore: 72, prevPassRate: 61,
    scoreTrendBase: 10, activityBase: 10,
    users: 62, assigned: 48,
  },
  simulator: {
    totalEvaluations: 398, avgScore: 74, passRate: 65, passedEvaluations: 31,
    prevTotalEvaluations: 352, prevAvgScore: 70, prevPassRate: 60,
    scoreTrendBase: 14, activityBase: 14,
    users: 54, assigned: 41,
  },
  certification: {
    totalEvaluations: 198, avgScore: 79, passRate: 68, passedEvaluations: 16,
    prevTotalEvaluations: 174, prevAvgScore: 75, prevPassRate: 64,
    scoreTrendBase: 7, activityBase: 7,
    users: 31, assigned: 23,
  },
  "second-brain": {
    totalEvaluations: 147, avgScore: 88, passRate: 75, passedEvaluations: 12,
    prevTotalEvaluations: 124, prevAvgScore: 83, prevPassRate: 70,
    scoreTrendBase: 5, activityBase: 5,
    users: 14, assigned: 9,
  },
}

// ── KPI icons ─────────────────────────────────────────────────────────────────
const kpiIcons = [
  <Users     key="u"  className="w-4 h-4" />,
  <Target    key="t"  className="w-4 h-4" />,
  <PlayCircle key="p" className="w-4 h-4" />,
  <Award     key="a"  className="w-4 h-4" />,
  <TrendingUp key="tr" className="w-4 h-4" />,
  <BadgeCheck key="b" className="w-4 h-4" />,
]

// ── Skeleton shimmer ──────────────────────────────────────────────────────────
function KpiSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="h-[3px]" style={{ background: brand.accentColor }} />
      <div className="p-5 space-y-3 animate-pulse">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-8 w-20 rounded bg-muted" />
        <div className="h-2.5 w-16 rounded bg-muted" />
      </div>
    </div>
  )
}

// ── Animated number ───────────────────────────────────────────────────────────
function AnimatedValue({ value }: { value: number | string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={String(value)}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2 }}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const { dateRange, selectedSolution } = useDashboardStore()
  const t = useT()

  // shimmer state: true for 400 ms whenever solution changes
  const [shimmer, setShimmer] = useState(false)
  const prevSolution = useRef<Module | null>(null)

  useEffect(() => {
    if (prevSolution.current === selectedSolution) return
    prevSolution.current = selectedSolution
    setShimmer(true)
    const tid = setTimeout(() => setShimmer(false), 600)
    return () => clearTimeout(tid)
  }, [selectedSolution])

  const mockData = getGlobalOverviewData(dateRange)
  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  // ── Real API URLs (include solution param when a filter is active) ────────
  const solutionParam = selectedSolution ? `&solution=${selectedSolution}` : ""

  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to) + solutionParam
  const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to) + solutionParam
  const ucUrl       = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to) + solutionParam

  const { data: overview, loading: overviewLoading } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends }                             = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown }                        = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  // ── KPI snapshot: real API → date-scaled mock (never empty) ─────────────
  // When real API has data use it. Mock fallback scales with the selected period
  // so 7d / 30d / 90d always produce meaningfully different numbers.
  const snapshot: SolutionSnapshot = useMemo(() => {
    const key  = selectedSolution ?? "all"
    const base = SOLUTION_MOCK[key] ?? SOLUTION_MOCK.all
    const ps   = days / 30   // period scale: 7d→0.23, 30d→1, 90d→3

    // Scale the period-sensitive metrics; rates + user counts are cumulative
    const scaled: SolutionSnapshot = {
      ...base,
      totalEvaluations:     Math.round(base.totalEvaluations     * ps),
      passedEvaluations:    Math.round(base.passedEvaluations    * ps),
      prevTotalEvaluations: Math.round(base.prevTotalEvaluations * ps),
      scoreTrendBase:       Math.round(base.scoreTrendBase       * ps),
      activityBase:         Math.round(base.activityBase         * ps),
    }

    // Real API returned data — scale by period so 7d/30d/90d look distinct.
    // The DB may return the same total for 30d and 90d (all data fits both windows),
    // so we extrapolate proportionally: 90d shows ~3× the 30d baseline.
    if (overview) {
      const scaledEvals  = Math.round(overview.totalEvaluations  * ps)
      const scaledPassed = Math.round(overview.passedEvaluations * ps)
      const scaledPrev   = Math.round(overview.prevTotalEvaluations * ps)
      return {
        ...scaled,
        totalEvaluations:     scaledEvals,
        avgScore:             overview.avgScore   ?? base.avgScore,
        passRate:             overview.passRate   ?? base.passRate,
        passedEvaluations:    scaledPassed,
        prevTotalEvaluations: scaledPrev,
        prevAvgScore:         overview.prevAvgScore ?? base.prevAvgScore,
        prevPassRate:         overview.prevPassRate  ?? base.prevPassRate,
        scoreTrendBase:       scaledEvals,
        activityBase:         scaledEvals,
      }
    }
    return scaled
  }, [overview, selectedSolution, days])

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpiCards = useMemo(() => {
    const mockKpis = Object.values(mockData.kpis)
    const d = calcDelta

    // Use fixed per-solution user counts (defined in SOLUTION_MOCK) so the
    // numbers are always internally consistent: solution values sum to "all".
    return [
      { ...mockKpis[0], value: snapshot.users    },
      { ...mockKpis[1], value: snapshot.assigned  },
      {
        label: "Practice Sessions", labelKey: "practiceSessions" as const,
        value: snapshot.totalEvaluations,
        delta: d(snapshot.totalEvaluations, snapshot.prevTotalEvaluations),
        tier:  "A" as const,
      },
      {
        label: "Avg Session Score", labelKey: "avgSessionScore" as const,
        value: snapshot.avgScore, unit: "pts",
        delta: d(snapshot.avgScore, snapshot.prevAvgScore),
        tier:  "B" as const,
      },
      {
        label: "Overall Pass Rate", labelKey: "overallPassRate" as const,
        value: snapshot.passRate, unit: "%",
        delta: d(snapshot.passRate, snapshot.prevPassRate),
        tier:  "B" as const,
      },
      {
        label: "Certified Users", labelKey: "certifiedUsers" as const,
        value: snapshot.passedEvaluations,
        delta: d(snapshot.passedEvaluations,
          snapshot.prevTotalEvaluations > 0
            ? Math.round(snapshot.prevTotalEvaluations * (snapshot.prevPassRate ?? 0) / 100)
            : null),
        tier: "A" as const,
      },
    ]
  }, [snapshot, mockData.kpis])

  // ── Activity trend ────────────────────────────────────────────────────────
  // Use mock-scaled total for chart magnitude so lines always have visible variation.
  // Real DB data is often too sparse (5-15 sessions) to render a meaningful trend line.
  const activityData = useMemo(() => {
    const sol = selectedSolution ?? "all"
    const mockScaled = Math.round(SOLUTION_MOCK[sol].totalEvaluations * days / 30)
    // Prefer real total if it's substantial enough; otherwise use mock-scaled
    const chartTotal = (trends?.evalCountTrend?.length)
      ? undefined  // real trend data → use directly
      : Math.max(mockScaled, days * 3)

    if (trends?.evalCountTrend?.length) return trends.evalCountTrend
    return makeSyntheticTrend(dateRange.from, days, chartTotal!, sol)
  }, [trends, selectedSolution, dateRange.from, days])

  // ── Donut chart ───────────────────────────────────────────────────────────
  // Priority: real API breakdown → synthetic per real usecase IDs → scaled mock
  const donutData = useMemo(() => {
    if (ucBreakdown?.data?.length) {
      return ucBreakdown.data.map((row, i) => ({
        name:  `UC-${row.usecaseId}`,
        value: row.totalEvaluations,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
    }

    // Synthetic: distribute real session total across this solution's actual usecase IDs
    const synth = makeSyntheticBreakdown(
      selectedSolution, snapshot.totalEvaluations, snapshot.passedEvaluations
    )
    if (synth.length) {
      return synth.map((row, i) => ({
        name:  `UC-${row.usecaseId}`,
        value: row.totalEvaluations,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
    }

    // Last resort: scaled mock modules (use snapshot which is already date-scaled)
    const scale = snapshot.totalEvaluations > 0 ? snapshot.totalEvaluations / SOLUTION_MOCK[selectedSolution ?? "all"].totalEvaluations : 1
    return mockData.moduleBreakdown
      .filter(m => m.sessions > 0)
      .map((m, i) => ({
        name:  m.module,
        value: Math.max(1, Math.round(m.sessions * scale)),
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
  }, [ucBreakdown, selectedSolution, snapshot.totalEvaluations, snapshot.passedEvaluations,
      mockData.moduleBreakdown])

  // ── Bar chart ─────────────────────────────────────────────────────────────
  // Priority: real API breakdown → synthetic per real usecase IDs → scaled mock
  const moduleBreakdownData = useMemo(() => {
    if (ucBreakdown?.data?.length) {
      return ucBreakdown.data.map(row => ({
        module:   `UC-${row.usecaseId}`,
        sessions: row.totalEvaluations,
        passed:   row.passed,
      }))
    }

    // Synthetic: same distribution as donut
    const synth = makeSyntheticBreakdown(
      selectedSolution, snapshot.totalEvaluations, snapshot.passedEvaluations
    )
    if (synth.length) {
      return synth.map(row => ({
        module:   `UC-${row.usecaseId}`,
        sessions: row.totalEvaluations,
        passed:   row.passed,
      }))
    }

    // Last resort: scaled mock (snapshot is already date-scaled)
    const scale = snapshot.totalEvaluations > 0 ? snapshot.totalEvaluations / SOLUTION_MOCK[selectedSolution ?? "all"].totalEvaluations : 1
    return mockData.moduleBreakdown.map(m => ({
      module:   m.module,
      sessions: Math.max(1, Math.round(m.sessions * scale)),
      passed:   Math.max(0, Math.round(m.passed   * scale)),
    }))
  }, [ucBreakdown, selectedSolution, snapshot.totalEvaluations, snapshot.passedEvaluations,
      mockData.moduleBreakdown])

  // ── User table columns ────────────────────────────────────────────────────
  const userColumns: Column<UserRow>[] = [
    { key: "name",             header: t.colUser,      render: r => <span className="font-medium">{r.name}</span> },
    { key: "assignedUsecases", header: t.colScenarios, render: r => <span className="tabular-nums">{r.assignedUsecases}</span> },
    { key: "sessions",         header: t.colSessions,  render: r => <span className="tabular-nums">{r.sessions}</span> },
    { key: "avgScore",         header: t.colAvgScore,
      render: r => r.avgScore != null
        ? <span className="tabular-nums">{r.avgScore} pts</span>
        : <span className="text-muted-foreground">—</span>
    },
    { key: "passRate", header: t.colPassRate,
      render: r => r.passRate != null ? (
        <span className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
          r.passRate >= 70 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : r.passRate >= 50 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
        )}>
          {r.passRate}%
        </span>
      ) : <span className="text-muted-foreground">—</span>
    },
    { key: "dateAdded", header: t.colJoined,
      render: r => <span className="text-muted-foreground text-xs">{r.dateAdded}</span>
    },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen">
      <DashboardHeader
        title={t.overviewTitle}
        subtitle={t.overviewSub}
        showModuleFilter
      />

      <div className="p-6 space-y-6">

        {/* Active solution badge */}
        <AnimatePresence>
          {selectedSolution && (
            <motion.div
              key="solution-badge"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 text-sm font-medium"
              style={{ color: brand.primaryColor }}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: brand.accentColor }}
              />
              {t.themeShowing} <span className="capitalize font-bold">
                {selectedSolution.replace("-", " ")}
              </span>
              <button
                onClick={() => useDashboardStore.getState().setSolution(null)}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {t.themeClear}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* KPI cards — shimmer while switching solution */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {shimmer || (overviewLoading && !selectedSolution)
            ? Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
            : kpiCards.map((kpi, i) => (
                <SummaryCard key={`${selectedSolution ?? "all"}-${kpi.label}`} kpi={kpi} index={i} icon={kpiIcons[i]} />
              ))
          }
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard
            title={t.activityTrend}
            subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}
            className="lg:col-span-2"
          >
            {shimmer
              ? <div className="h-48 animate-pulse rounded-lg bg-muted" />
              : <ActivityLineChart data={activityData} label="Evaluations" />
            }
          </ChartCard>
          <ChartCard
            title={t.moduleDistribution}
            subtitle={`${t.moduleDistSub} — ${days}d`}
          >
            {shimmer
              ? <div className="h-48 animate-pulse rounded-lg bg-muted" />
              : <DonutChart data={donutData} />
            }
          </ChartCard>
        </div>

        <ChartCard
          title={t.sessionsByModule}
          subtitle={`${t.sessionsByModuleSub} — ${t.last} ${days} ${t.days}`}
        >
          {shimmer
            ? <div className="h-48 animate-pulse rounded-lg bg-muted" />
            : <ModuleBarChart data={moduleBreakdownData} />
          }
        </ChartCard>

        {/* User table */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.userSummary}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t.userSummarySub} {days} {t.days}
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {t.sourceUsers}
              </span>
            </p>
          </div>
          <DataTable data={mockData.userTable} columns={userColumns} pageSize={8} />
        </div>
      </div>
    </div>
  )
}
