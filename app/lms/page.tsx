"use client"

import { useMemo } from "react"
import { BookOpen, Users, CheckCircle, Star, BarChart2, AlertTriangle } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { calcDeltaPct, estimatePassedSessions } from "@/lib/kpi-builder"
import { csvFilename } from "@/lib/csv-export"
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

function EmptyState() {
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>No data available</span>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export default function LmsPage() {
  const { dateRange, clientId, refreshKey } = useDashboardStore()
  const t     = useT()
  const brand = useClientBrand()
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: "lms", clientId, rk: refreshKey })
  const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to, { solution: "lms", clientId, rk: refreshKey })
  const ucUrl       = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: "lms", clientId, rk: refreshKey })

  const { data: overview, loading: overviewLoading, error: overviewError } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,   loading: trendsLoading,   error: trendsError }   = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown, loading: ucLoading,    error: ucError }       = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  const hasData = overview && overview.totalEvaluations > 0

  const kpis = useMemo(() => {
    if (!hasData) return []
    return [
      {
        // FIX: was passedEvaluations + totalEvaluations (double-count) — use totalEvaluations only
        label: "Enrolled Users", labelKey: "enrolledUsers" as const,
        value: overview!.totalEvaluations,
        delta: calcDeltaPct(overview!.totalEvaluations, overview!.prevTotalEvaluations),
        tier: "A" as const,
      },
      {
        label: "Completion Rate", labelKey: "completionRate" as const,
        value: overview!.passRate ?? 0, unit: "%",
        delta: calcDeltaPct(overview!.passRate ?? 0, overview!.prevPassRate ?? 0),
        tier: "B" as const,
      },
      {
        label: "Avg Quiz Score", labelKey: "avgQuizScore" as const,
        value: overview!.avgScore ?? 0, unit: "pts",
        delta: calcDeltaPct(overview!.avgScore ?? 0, overview!.prevAvgScore ?? 0),
        tier: "B" as const,
      },
      {
        label: "Modules Completed", labelKey: "modulesCompleted" as const,
        value: overview!.passedEvaluations,
        delta: calcDeltaPct(
          overview!.passedEvaluations,
          estimatePassedSessions(overview!.prevTotalEvaluations, overview!.prevPassRate)
        ),
        tier: "A" as const,
      },
    ]
  }, [overview, hasData])

  const activityData = useMemo(
    () => trends?.evalCountTrend ?? [],
    [trends]
  )

  const ucColumns: Column<UsecaseApiRow>[] = useMemo(() => [
    { key: "usecaseId",        header: t.colScenario,  render: r => <span className="font-medium">UC-{r.usecaseId}</span> },
    { key: "totalEvaluations", header: t.colSessions,  render: r => <span className="tabular-nums">{r.totalEvaluations}</span> },
    { key: "avgScore",         header: t.colAvgScore,  render: r => r.avgScore != null ? <span className="tabular-nums">{r.avgScore} pts</span> : <span className="text-muted-foreground">—</span> },
    { key: "passRate", header: t.colPassRate, render: r => r.passRate != null ? (
      <span className={cn("inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
        r.passRate >= 70 ? "bg-primary/10 text-primary"
          : r.passRate >= 50 ? "bg-secondary text-secondary-foreground"
          : "bg-destructive/10 text-destructive")}>
        {r.passRate}%
      </span>
    ) : <span className="text-muted-foreground">—</span> },
    { key: "passed", header: t.colPassed, render: r => <span className="tabular-nums">{r.passed}</span> },
  ], [t])

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.lmsTitle} subtitle={t.lmsSub} />
      <div className="p-6 space-y-6">

        {/* Error banners */}
        {overviewError && <ErrorBanner message={`${t.errorLoading}: ${overviewError}`} />}

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {overviewLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                  <div className="h-[3px] bg-primary" />
                  <div className="p-5 space-y-3 animate-pulse">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-8 w-20 rounded bg-muted" />
                  </div>
                </div>
              ))
            : kpis.length > 0
              ? kpis.map((kpi, i) => <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]} />)
              : Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="h-[3px] bg-primary" />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">No data available</div>
                  </div>
                ))
          }
        </div>

        {/* Activity chart */}
        {trendsError && <ErrorBanner message={`${t.errorLoading}: ${trendsError}`} />}
        <ChartCard title={t.activityTrend} subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}>
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : activityData.length > 0
              ? <ActivityLineChart data={activityData} label="Sessions" color={brand.chartColors[0]} />
              : <EmptyState />
          }
        </ChartCard>

        {/* Usecase breakdown table */}
        {ucError && <ErrorBanner message={`${t.errorLoading}: ${ucError}`} />}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">{t.usecaseBreakdown}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ucLoading ? t.loading : `${ucBreakdown?.data?.length ?? 0} ${t.usecaseBreakdownSub}`}
                <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">{t.navLms}</span>
              </p>
            </div>
            <ExportButton
              data={ucBreakdown?.data ?? []}
              filename={csvFilename("lms-usecase-breakdown")}
              columns={[
                { header: "Use Case ID",        value: r => r.usecaseId },
                { header: "Total Evaluations",  value: r => r.totalEvaluations },
                { header: "Avg Score (pts)",    value: r => r.avgScore },
                { header: "Pass Rate (%)",      value: r => r.passRate },
                { header: "Passed",             value: r => r.passed },
              ]}
            />
          </div>
          {ucLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : ucBreakdown?.data?.length
              ? <DataTable data={ucBreakdown.data} columns={ucColumns} pageSize={8} />
              : <div className="py-10 text-center text-sm text-muted-foreground">No data available</div>
          }
        </div>
      </div>
    </div>
  )
}
