"use client"

import { useMemo } from "react"
import { Users, Target, PlayCircle, Award, TrendingUp, BadgeCheck } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { ModuleBarChart } from "@/components/charts/ModuleBarChart"
import { DonutChart } from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getGlobalOverviewData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDelta } from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  UserRow,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const kpiIcons = [
  <Users key="u" className="w-4 h-4" />,
  <Target key="t" className="w-4 h-4" />,
  <PlayCircle key="p" className="w-4 h-4" />,
  <Award key="a" className="w-4 h-4" />,
  <TrendingUp key="tr" className="w-4 h-4" />,
  <BadgeCheck key="b" className="w-4 h-4" />,
]

const kpiAccents = [
  "from-blue-500/10 to-blue-500/5",
  "from-violet-500/10 to-violet-500/5",
  "from-emerald-500/10 to-emerald-500/5",
  "from-amber-500/10 to-amber-500/5",
  "from-pink-500/10 to-pink-500/5",
  "from-teal-500/10 to-teal-500/5",
]

const DONUT_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ec4899",
  "#3b82f6", "#8b5cf6", "#14b8a6", "#f97316",
]

export default function OverviewPage() {
  const { dateRange } = useDashboardStore()
  const t = useT()

  // Mock data — for sections not yet in analytics DB (user table)
  const mockData = getGlobalOverviewData(dateRange)
  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  // Real API: overview KPIs
  const overviewUrl = buildApiUrl(
    "/api/dashboard/overview",
    dateRange.from,
    dateRange.to
  )
  const { data: overview, loading: overviewLoading, error: overviewError } =
    useApi<OverviewApiResponse>(overviewUrl)

  // Real API: trends
  const trendsUrl = buildApiUrl(
    "/api/dashboard/trends",
    dateRange.from,
    dateRange.to
  )
  const { data: trends, loading: trendsLoading } =
    useApi<TrendsApiResponse>(trendsUrl)

  // Real API: usecase breakdown (for charts)
  const ucUrl = buildApiUrl(
    "/api/dashboard/usecase-breakdown",
    dateRange.from,
    dateRange.to
  )
  const { data: ucBreakdown } = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  // ── KPI cards: mix real + mock ──────────────────────────────────────────────
  // Slots 0–1 (Total Users, Assigned) → mock (coach DB not connected yet)
  // Slots 2–5 (Sessions, Avg Score, Pass Rate, Certified) → real analytics DB
  const kpiCards = useMemo(() => {
    const mockKpis = Object.values(mockData.kpis)

    if (overviewLoading || !overview) return mockKpis // show mock while loading

    const realDelta = (cur: number | null, prev: number | null) =>
      calcDelta(cur, prev)

    return [
      mockKpis[0], // totalUsers — mock
      mockKpis[1], // assignedToScenarios — mock
      {
        label:    'Practice Sessions',
        labelKey: 'practiceSessions' as const,
        value:    overview.totalEvaluations,
        delta:    realDelta(overview.totalEvaluations, overview.prevTotalEvaluations),
        tier:     'A' as const,
      },
      {
        label:    'Avg Session Score',
        labelKey: 'avgSessionScore' as const,
        value:    overview.avgScore ?? '—',
        delta:    realDelta(overview.avgScore, overview.prevAvgScore),
        unit:     'pts',
        tier:     'B' as const,
      },
      {
        label:    'Overall Pass Rate',
        labelKey: 'overallPassRate' as const,
        value:    overview.passRate ?? '—',
        delta:    realDelta(overview.passRate, overview.prevPassRate),
        unit:     '%',
        tier:     'B' as const,
      },
      {
        label:    'Certified Users',
        labelKey: 'certifiedUsers' as const,
        value:    overview.passedEvaluations,
        delta:    realDelta(overview.passedEvaluations, overview.prevTotalEvaluations > 0
          ? Math.round(overview.prevTotalEvaluations * (overview.prevPassRate ?? 0) / 100)
          : null),
        tier:     'A' as const,
      },
    ]
  }, [overview, overviewLoading, mockData.kpis])

  // ── Activity trend: real daily eval count (falls back to mock) ───────────────
  const activityData = useMemo(() => {
    if (trends?.evalCountTrend?.length) return trends.evalCountTrend
    return mockData.activityTrend
  }, [trends, mockData.activityTrend])

  // ── Donut chart: real usecase breakdown (falls back to mock) ─────────────────
  const donutData = useMemo(() => {
    if (ucBreakdown?.data?.length) {
      return ucBreakdown.data.map((row, i) => ({
        name:  `UC-${row.usecaseId}`,
        value: row.totalEvaluations,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
    }
    // fallback: derive from mock
    return mockData.moduleBreakdown
      .filter(m => m.sessions > 0)
      .map((m, i) => ({
        name:  m.module,
        value: m.sessions,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      }))
  }, [ucBreakdown, mockData.moduleBreakdown])

  // ── Bar chart: real usecase breakdown (falls back to mock) ───────────────────
  const moduleBreakdownData = useMemo(() => {
    if (ucBreakdown?.data?.length) {
      return ucBreakdown.data.map(row => ({
        module:   `UC-${row.usecaseId}`,
        sessions: row.totalEvaluations,
        passed:   row.passed,
      }))
    }
    return mockData.moduleBreakdown
  }, [ucBreakdown, mockData.moduleBreakdown])

  // ── User table columns (real user data not in analytics DB — kept mock) ───────
  const userColumns: Column<UserRow>[] = [
    { key: "name",             header: t.colUser,      render: r => <span className="font-medium">{r.name}</span> },
    { key: "assignedUsecases", header: t.colScenarios, render: r => <span className="tabular-nums">{r.assignedUsecases}</span> },
    { key: "sessions",         header: t.colSessions,  render: r => <span className="tabular-nums">{r.sessions}</span> },
    {
      key: "avgScore", header: t.colAvgScore,
      render: r => r.avgScore != null
        ? <span className="tabular-nums">{r.avgScore} pts</span>
        : <span className="text-muted-foreground">—</span>
    },
    {
      key: "passRate", header: t.colPassRate,
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
    { key: "dateAdded", header: t.colJoined, render: r => <span className="text-muted-foreground text-xs">{r.dateAdded}</span> },
  ]

  return (
    <div className="min-h-screen">
      <DashboardHeader
        title={t.overviewTitle}
        subtitle={t.overviewSub}
        showModuleFilter
      />
      <div className="p-6 space-y-6">
        {/* KPI cards */}
        {overviewError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
            {t.errorLoading}: {overviewError}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpiCards.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={kpiIcons[i]} accent={kpiAccents[i]} />
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard
            title={t.activityTrend}
            subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}
            className="lg:col-span-2"
          >
            {trendsLoading
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

        {/* User table — kept mock (user data in separate DB) */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.userSummary}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t.userSummarySub} {days} {t.days}
              <span className="ml-2 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">
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
