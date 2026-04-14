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

// ── Donut colour palette ──────────────────────────────────────────────────────
const DONUT_COLORS = brand.chartColors

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
  scoreTrendBase:  number   // daily avg sessions for line chart
  activityBase:    number   // daily eval count
}

const SOLUTION_MOCK: Record<string, SolutionSnapshot> = {
  all: {
    totalEvaluations: 1342, avgScore: 76, passRate: 63, passedEvaluations: 94,
    prevTotalEvaluations: 1041, prevAvgScore: 71, prevPassRate: 58,
    scoreTrendBase: 45, activityBase: 45,
  },
  lms: {
    totalEvaluations: 312, avgScore: 82, passRate: 71, passedEvaluations: 28,
    prevTotalEvaluations: 271, prevAvgScore: 78, prevPassRate: 66,
    scoreTrendBase: 11, activityBase: 11,
  },
  coach: {
    totalEvaluations: 287, avgScore: 69, passRate: 58, passedEvaluations: 19,
    prevTotalEvaluations: 320, prevAvgScore: 72, prevPassRate: 61,
    scoreTrendBase: 10, activityBase: 10,
  },
  simulator: {
    totalEvaluations: 398, avgScore: 74, passRate: 65, passedEvaluations: 31,
    prevTotalEvaluations: 352, prevAvgScore: 70, prevPassRate: 60,
    scoreTrendBase: 14, activityBase: 14,
  },
  certification: {
    totalEvaluations: 198, avgScore: 79, passRate: 68, passedEvaluations: 16,
    prevTotalEvaluations: 174, prevAvgScore: 75, prevPassRate: 64,
    scoreTrendBase: 7, activityBase: 7,
  },
  "second-brain": {
    totalEvaluations: 147, avgScore: 88, passRate: 75, passedEvaluations: 12,
    prevTotalEvaluations: 124, prevAvgScore: 83, prevPassRate: 70,
    scoreTrendBase: 5, activityBase: 5,
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
    const tid = setTimeout(() => setShimmer(false), 400)
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
  const { data: trends,   loading: trendsLoading }   = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown }                        = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  // ── KPI snapshot: real API → solution mock (never empty) ─────────────────
  const snapshot: SolutionSnapshot = useMemo(() => {
    const key = selectedSolution ?? "all"
    const mock = SOLUTION_MOCK[key] ?? SOLUTION_MOCK.all

    // If real API returned data AND no solution filter (API doesn't support filtering yet),
    // blend real numbers into the "all" snapshot; solution-filtered views use pure mock.
    if (overview && !selectedSolution) {
      return {
        ...mock,
        totalEvaluations:     overview.totalEvaluations,
        avgScore:             overview.avgScore ?? mock.avgScore,
        passRate:             overview.passRate ?? mock.passRate,
        passedEvaluations:    overview.passedEvaluations,
        prevTotalEvaluations: overview.prevTotalEvaluations,
        prevAvgScore:         overview.prevAvgScore ?? mock.prevAvgScore,
        prevPassRate:         overview.prevPassRate ?? mock.prevPassRate,
      }
    }
    return mock
  }, [overview, selectedSolution])

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpiCards = useMemo(() => {
    const mockKpis = Object.values(mockData.kpis)
    const d = calcDelta

    return [
      mockKpis[0], // Total Users — from user DB (always mock)
      mockKpis[1], // Assigned to Scenarios — from user DB (always mock)
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
            ? Math.round(snapshot.prevTotalEvaluations * snapshot.prevPassRate / 100)
            : null),
        tier: "A" as const,
      },
    ]
  }, [snapshot, mockData.kpis])

  // ── Activity trend ────────────────────────────────────────────────────────
  const activityData = useMemo(() => {
    if (!selectedSolution && trends?.evalCountTrend?.length) return trends.evalCountTrend
    return mockData.activityTrend.map(p => ({
      ...p,
      value: Math.max(1, Math.round(p.value * (snapshot.activityBase / 45))),
    }))
  }, [trends, selectedSolution, mockData.activityTrend, snapshot.activityBase])

  // ── Donut chart ───────────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    if (!selectedSolution && ucBreakdown?.data?.length) {
      return ucBreakdown.data.map((row, i) => ({
        name:  `UC-${row.usecaseId}`,
        value: row.totalEvaluations,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
    }
    return mockData.moduleBreakdown
      .filter(m => m.sessions > 0)
      .map((m, i) => ({
        name:  m.module,
        value: Math.max(1, Math.round(m.sessions * (snapshot.totalEvaluations / 1342))),
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
  }, [ucBreakdown, selectedSolution, mockData.moduleBreakdown, snapshot.totalEvaluations])

  // ── Bar chart ─────────────────────────────────────────────────────────────
  const moduleBreakdownData = useMemo(() => {
    if (!selectedSolution && ucBreakdown?.data?.length) {
      return ucBreakdown.data.map(row => ({
        module:   `UC-${row.usecaseId}`,
        sessions: row.totalEvaluations,
        passed:   row.passed,
      }))
    }
    const scale = snapshot.totalEvaluations / 1342
    return mockData.moduleBreakdown.map(m => ({
      module:   m.module,
      sessions: Math.max(1, Math.round(m.sessions * scale)),
      passed:   Math.max(0, Math.round(m.passed   * scale)),
    }))
  }, [ucBreakdown, selectedSolution, mockData.moduleBreakdown, snapshot.totalEvaluations])

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
              Showing: <span className="capitalize font-bold">
                {selectedSolution.replace("-", " ")}
              </span>
              <button
                onClick={() => useDashboardStore.getState().setSolution(null)}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Clear
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
            {trendsLoading && !selectedSolution
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : <ActivityLineChart data={activityData} label="Evaluations" />
            }
          </ChartCard>
          <ChartCard
            title={t.moduleDistribution}
            subtitle={`${t.moduleDistSub} — ${days}d`}
          >
            <DonutChart data={donutData} />
          </ChartCard>
        </div>

        <ChartCard
          title={t.sessionsByModule}
          subtitle={`${t.sessionsByModuleSub} — ${t.last} ${days} ${t.days}`}
        >
          <ModuleBarChart data={moduleBreakdownData} />
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
