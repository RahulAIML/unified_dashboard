"use client"

import { useMemo } from "react"
import Link from "next/link"
import { BadgeCheck, TrendingUp, Award, Users, BarChart2, AlertTriangle } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { StackedBarChart } from "@/components/charts/StackedBarChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDeltaPct, estimatePassedSessions } from "@/lib/kpi-builder"
import { csvFilename } from "@/lib/csv-export"
import { cn } from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  ResultsApiResponse,
  EvaluationApiRow,
} from "@/lib/types"

const icons = [
  <BadgeCheck key="b" className="w-4 h-4" />,
  <TrendingUp key="t" className="w-4 h-4" />,
  <Award      key="a" className="w-4 h-4" />,
  <Users      key="u" className="w-4 h-4" />,
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

export default function CertificationPage() {
  const { dateRange, clientId, refreshKey } = useDashboardStore()
  const t     = useT()
  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: "certification", clientId, rk: refreshKey })
  const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to, { solution: "certification", clientId, rk: refreshKey })
  const resultsUrl  = buildApiUrl("/api/dashboard/results",  dateRange.from, dateRange.to, { limit: 100, solution: "certification", clientId, rk: refreshKey })

  const { data: overview, loading: overviewLoading, error: overviewError } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,   loading: trendsLoading,   error: trendsError }   = useApi<TrendsApiResponse>(trendsUrl)
  const { data: results,  loading: resultsLoading,  error: resultsError }  = useApi<ResultsApiResponse>(resultsUrl)

  const hasData = overview && overview.totalEvaluations > 0

  const kpis = useMemo(() => {
    if (!hasData) return []
    return [
      {
        label: "Candidates Evaluated", labelKey: "candidatesEvaluated" as const,
        value: overview!.totalEvaluations,
        delta: calcDeltaPct(overview!.totalEvaluations, overview!.prevTotalEvaluations),
        tier: "A" as const,
      },
      {
        label: "Pass Rate", labelKey: "passRate" as const,
        value: overview!.passRate ?? 0, unit: "%",
        delta: calcDeltaPct(overview!.passRate ?? 0, overview!.prevPassRate ?? 0),
        tier: "B" as const,
      },
      {
        label: "Avg Score", labelKey: "avgScore" as const,
        value: overview!.avgScore ?? 0, unit: "pts",
        delta: calcDeltaPct(overview!.avgScore ?? 0, overview!.prevAvgScore ?? 0),
        tier: "B" as const,
      },
      {
        label: "Certified Users", labelKey: "certifiedUsers" as const,
        value: overview!.passedEvaluations,
        delta: calcDeltaPct(
          overview!.passedEvaluations,
          estimatePassedSessions(overview!.prevTotalEvaluations, overview!.prevPassRate)
        ),
        tier: "A" as const,
      },
    ]
  }, [overview, hasData])

  const columns: Column<EvaluationApiRow>[] = useMemo(() => [
    {
      key: "savedReportId",
      header: t.colReportId,
      render: r => (
        <Link
          href={`/drilldown/${r.savedReportId}`}
          className="font-medium font-mono text-xs hover:underline underline-offset-2 text-primary"
        >
          #{r.savedReportId}
        </Link>
      ),
    },
    {
      key: "usecaseId",
      header: t.colUsecaseId,
      render: r => (
        <span className="text-muted-foreground">
          {r.usecaseId != null ? `UC-${r.usecaseId}` : "—"}
        </span>
      ),
    },
    {
      key: "score",
      header: t.colScore,
      render: r => r.score != null
        ? <span className="tabular-nums font-semibold">{r.score} pts</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "passed",
      header: t.colResult,
      render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
          r.passed
            ? "bg-primary/10 text-primary"
            : "bg-destructive/10 text-destructive"
        )}>
          {r.passed ? t.passLabel : t.failLabel}
        </span>
      ),
    },
    {
      key: "result",
      header: t.colSegment,
      render: r => <span className="text-muted-foreground text-xs">{r.result ?? "—"}</span>,
    },
    {
      key: "date",
      header: t.colDate,
      render: r => <span className="text-muted-foreground text-xs">{r.date}</span>,
    },
  ], [t])

  const passFailData = trends?.passFailTrend ?? []

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.certTitle} subtitle={t.certSub} />
      <div className="p-6 space-y-6">

        {/* Error banners */}
        {overviewError && <ErrorBanner message={`${t.errorLoading}: ${overviewError}`} />}

        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
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
              ? kpis.map((kpi, i) => (
                  <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]} />
                ))
              : Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="h-[3px] bg-primary" />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">No data available</div>
                  </div>
                ))
          }
        </div>

        {/* Pass/Fail chart */}
        {trendsError && <ErrorBanner message={`${t.errorLoading}: ${trendsError}`} />}
        <ChartCard
          title={t.passFailOverTime}
          subtitle={`${t.passFailSub} — ${t.last} ${days} ${t.days}`}
        >
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : passFailData.length > 0
              ? <StackedBarChart data={passFailData} />
              : <EmptyState />
          }
        </ChartCard>

        {/* Results table */}
        {resultsError && <ErrorBanner message={`${t.errorLoading}: ${resultsError}`} />}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">{t.evaluationResults}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {resultsLoading
                  ? t.loading
                  : `${results?.data?.length ?? 0} ${t.evaluationsSub} ${days} ${t.days}`}
                <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  {t.sourceCert}
                </span>
              </p>
            </div>
            <ExportButton
              data={results?.data ?? []}
              filename={csvFilename("certification-results")}
              columns={[
                { header: "Report ID",       value: r => r.savedReportId },
                { header: "Use Case ID",     value: r => r.usecaseId },
                { header: "Score (pts)",     value: r => r.score },
                { header: "Result",          value: r => r.passed ? "PASS" : "FAIL" },
                { header: "Segment",         value: r => r.result },
                { header: "Date",            value: r => r.date },
              ]}
            />
          </div>
          {resultsLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : results?.data?.length
              ? <DataTable data={results.data} columns={columns} pageSize={10} />
              : <div className="py-10 text-center text-sm text-muted-foreground">No data available</div>
          }
        </div>
      </div>
    </div>
  )
}
