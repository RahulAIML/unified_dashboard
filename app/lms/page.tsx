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
import { getSolutionData } from "@/lib/solution-data"
import type { UsecaseBreakdownApiResponse, UsecaseApiRow } from "@/lib/types"

const icons = [
  <Users       key="u" className="w-4 h-4" />,
  <CheckCircle key="c" className="w-4 h-4" />,
  <Star        key="s" className="w-4 h-4" />,
  <BookOpen    key="b" className="w-4 h-4" />,
]

export default function LmsPage() {
  const { dateRange } = useDashboardStore()
  const t = useT()
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  const d = getSolutionData("lms", days)

  // Charts still use real API when available
  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to) + "&solution=lms"
  const ucUrl     = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to) + "&solution=lms"
  const { data: trends, loading: trendsLoading } = useApi<any>(trendsUrl)
  const { data: ucBreakdown, loading: ucLoading } = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  const kpis = useMemo(() => [
    {
      label: "Enrolled Users", labelKey: "enrolledUsers" as const,
      value: d.users,
      delta: calcDelta(d.users, Math.round(d.users * 0.88)),
      tier: "A" as const,
    },
    {
      label: "Completion Rate", labelKey: "completionRate" as const,
      value: d.passRate, unit: "%",
      delta: calcDelta(d.passRate, d.prevPassRate),
      tier: "B" as const,
    },
    {
      label: "Avg Quiz Score", labelKey: "avgQuizScore" as const,
      value: d.avgScore, unit: "pts",
      delta: calcDelta(d.avgScore, d.prevAvgScore),
      tier: "B" as const,
    },
    {
      label: "Modules Completed", labelKey: "modulesCompleted" as const,
      value: d.passedEvaluations,
      delta: calcDelta(d.passedEvaluations, d.prevTotalEvaluations > 0
        ? Math.round(d.prevTotalEvaluations * d.prevPassRate / 100) : null),
      tier: "A" as const,
    },
  ], [d])

  const activityData = useMemo(
    () => trends?.evalCountTrend?.length ? trends.evalCountTrend : [],
    [trends]
  )

  const ucColumns: Column<UsecaseApiRow>[] = useMemo(() => [
    { key: "usecaseId",        header: t.colScenario,  render: r => <span className="font-medium">UC-{r.usecaseId}</span> },
    { key: "totalEvaluations", header: t.colSessions,  render: r => <span className="tabular-nums">{r.totalEvaluations}</span> },
    { key: "avgScore",         header: t.colAvgScore,  render: r => r.avgScore != null ? <span className="tabular-nums">{r.avgScore} pts</span> : <span className="text-muted-foreground">—</span> },
    { key: "passRate", header: t.colPassRate, render: r => r.passRate != null ? (
      <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
        r.passRate >= 70 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : r.passRate >= 50 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-rose-500/15 text-rose-600 dark:text-rose-400")}>
        {r.passRate}%
      </span>
    ) : <span className="text-muted-foreground">—</span> },
    { key: "passed", header: t.colPassed, render: r => <span className="tabular-nums">{r.passed}</span> },
  ], [t])

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.lmsTitle} subtitle={t.lmsSub} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]} />)}
        </div>

        <ChartCard title={t.activityTrend} subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}>
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : activityData.length > 0
              ? <ActivityLineChart data={activityData} label="Sessions" color={brand.chartColors[0]} />
              : <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.noData}</div>
          }
        </ChartCard>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.usecaseBreakdown}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ucLoading ? t.loading : `${ucBreakdown?.data?.length ?? 0} ${t.usecaseBreakdownSub}`}
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">{t.navLms}</span>
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
