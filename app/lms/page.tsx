"use client"

import { useMemo } from "react"
import { BookOpen, Users, CheckCircle, Star } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDelta } from "@/lib/utils"
import { brand } from "@/lib/brand"
import { cn } from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  UsecaseApiRow,
} from "@/lib/types"

const icons = [
  <Users       key="u" className="w-4 h-4" />,
  <CheckCircle key="c" className="w-4 h-4" />,
  <Star        key="s" className="w-4 h-4" />,
  <BookOpen    key="b" className="w-4 h-4" />,
]

export default function LmsPage() {
  const { dateRange } = useDashboardStore()
  const t = useT()
  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  // ── Real API calls filtered to LMS usecases (323, 351, 363) ──────────────
  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to)
    + "&solution=lms"
  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to)
    + "&solution=lms"
  const ucUrl = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to)
    + "&solution=lms"

  const { data: overview, loading: overviewLoading, error: overviewError } =
    useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends, loading: trendsLoading } =
    useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown, loading: ucLoading } =
    useApi<UsecaseBreakdownApiResponse>(ucUrl)

  // ── KPI cards ─────────────────────────────────────────────────────────────
  // Map analytics DB fields onto LMS card labels:
  //  • totalEvaluations  → Enrolled Users (learners who completed at least one session)
  //  • passRate          → Completion Rate
  //  • avgScore          → Avg Quiz Score
  //  • passedEvaluations → Modules Completed
  const kpis = useMemo(() => {
    const loading = overviewLoading || !overview
    return [
      {
        label:    "Enrolled Users",
        labelKey: "enrolledUsers" as const,
        value:    loading ? "—" : overview!.totalEvaluations,
        delta:    loading ? 0 : calcDelta(overview!.totalEvaluations, overview!.prevTotalEvaluations),
        tier:     "A" as const,
      },
      {
        label:    "Completion Rate",
        labelKey: "completionRate" as const,
        value:    loading ? "—" : (overview!.passRate ?? "—"),
        delta:    loading ? 0 : calcDelta(overview!.passRate, overview!.prevPassRate),
        unit:     "%",
        tier:     "B" as const,
      },
      {
        label:    "Avg Quiz Score",
        labelKey: "avgQuizScore" as const,
        value:    loading ? "—" : (overview!.avgScore ?? "—"),
        delta:    loading ? 0 : calcDelta(overview!.avgScore, overview!.prevAvgScore),
        unit:     "pts",
        tier:     "B" as const,
      },
      {
        label:    "Modules Completed",
        labelKey: "modulesCompleted" as const,
        value:    loading ? "—" : overview!.passedEvaluations,
        delta:    loading ? 0 : calcDelta(
          overview!.passedEvaluations,
          overview!.prevTotalEvaluations > 0
            ? Math.round(overview!.prevTotalEvaluations * (overview!.prevPassRate ?? 0) / 100)
            : null
        ),
        tier:     "A" as const,
      },
    ]
  }, [overview, overviewLoading])

  // ── Activity trend ────────────────────────────────────────────────────────
  const activityData = useMemo(
    () => trends?.evalCountTrend?.length ? trends.evalCountTrend : [],
    [trends]
  )

  // ── Usecase breakdown table columns ──────────────────────────────────────
  const ucColumns: Column<UsecaseApiRow>[] = useMemo(() => [
    {
      key: "usecaseId",
      header: t.colScenario,
      render: r => <span className="font-medium">UC-{r.usecaseId}</span>,
    },
    {
      key: "totalEvaluations",
      header: t.colSessions,
      render: r => <span className="tabular-nums">{r.totalEvaluations}</span>,
    },
    {
      key: "avgScore",
      header: t.colAvgScore,
      render: r => r.avgScore != null
        ? <span className="tabular-nums">{r.avgScore} pts</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "passRate",
      header: t.colPassRate,
      render: r => r.passRate != null ? (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.passRate >= 70 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : r.passRate >= 50 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
        )}>
          {r.passRate}%
        </span>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "passed",
      header: t.colPassed,
      render: r => <span className="tabular-nums">{r.passed}</span>,
    },
  ], [t])

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.lmsTitle} subtitle={t.lmsSub} />
      <div className="p-6 space-y-6">

        {overviewError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
            {t.errorLoading}: {overviewError}
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]} />
          ))}
        </div>

        {/* Activity trend */}
        <ChartCard
          title={t.activityTrend}
          subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}
        >
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : activityData.length > 0
              ? <ActivityLineChart data={activityData} label="Sessions" color={brand.chartColors[0]} />
              : <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.noData}</div>
          }
        </ChartCard>

        {/* Usecase breakdown table */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.usecaseBreakdown}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ucLoading
                ? t.loading
                : `${ucBreakdown?.data?.length ?? 0} ${t.usecaseBreakdownSub}`
              }
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {t.navLms}
              </span>
            </p>
          </div>
          {ucLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : ucBreakdown?.data?.length
              ? <DataTable data={ucBreakdown.data} columns={ucColumns} pageSize={8} />
              : <div className="py-10 text-center text-sm text-muted-foreground">{t.noData}</div>
          }
        </div>

      </div>
    </div>
  )
}
