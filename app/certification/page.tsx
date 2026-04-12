"use client"

import { useMemo } from "react"
import { BadgeCheck, TrendingUp, Award, Clock } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { StackedBarChart } from "@/components/charts/StackedBarChart"
import { DataTable, type Column } from "@/components/DataTable"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDelta } from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  ResultsApiResponse,
  EvaluationApiRow,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const icons = [
  <BadgeCheck key="b" className="w-4 h-4" />,
  <TrendingUp key="t" className="w-4 h-4" />,
  <Award      key="a" className="w-4 h-4" />,
  <Clock      key="c" className="w-4 h-4" />,
]

export default function CertificationPage() {
  const { dateRange } = useDashboardStore()
  const t = useT()
  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  // ── Real API calls ────────────────────────────────────────────────────────
  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to)
  const { data: overview, loading: overviewLoading, error: overviewError } =
    useApi<OverviewApiResponse>(overviewUrl)

  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to)
  const { data: trends, loading: trendsLoading } = useApi<TrendsApiResponse>(trendsUrl)

  const resultsUrl = buildApiUrl("/api/dashboard/results", dateRange.from, dateRange.to,
    { limit: "100" })
  const { data: results, loading: resultsLoading } = useApi<ResultsApiResponse>(resultsUrl)

  // ── KPI cards from real data ──────────────────────────────────────────────
  const kpis = useMemo(() => {
    const loading = overviewLoading || !overview
    return [
      {
        label:    'Candidates Evaluated',
        labelKey: 'candidatesEvaluated' as const,
        value:    loading ? '—' : overview!.totalEvaluations,
        delta:    loading ? 0 : calcDelta(overview!.totalEvaluations, overview!.prevTotalEvaluations),
        tier:     'A' as const,
      },
      {
        label:    'Pass Rate',
        labelKey: 'passRate' as const,
        value:    loading ? '—' : (overview!.passRate ?? '—'),
        delta:    loading ? 0 : calcDelta(overview!.passRate, overview!.prevPassRate),
        unit:     '%',
        tier:     'B' as const,
      },
      {
        label:    'Avg Score',
        labelKey: 'avgScore' as const,
        value:    loading ? '—' : (overview!.avgScore ?? '—'),
        delta:    loading ? 0 : calcDelta(overview!.avgScore, overview!.prevAvgScore),
        unit:     'pts',
        tier:     'B' as const,
      },
      {
        // Pending cannot be derived from analytics DB — shown as 0
        label:    'Pending Evaluations',
        labelKey: 'pendingEvaluations' as const,
        value:    0,
        delta:    0,
        tier:     'B' as const,
      },
    ]
  }, [overview, overviewLoading])

  // ── Results table columns ─────────────────────────────────────────────────
  const columns: Column<EvaluationApiRow>[] = useMemo(() => [
    {
      key: "savedReportId",
      header: t.colReportId,
      render: r => <span className="font-medium font-mono text-xs">#{r.savedReportId}</span>,
    },
    {
      key: "usecaseId",
      header: t.colUsecaseId,
      render: r => <span className="text-muted-foreground">
        {r.usecaseId != null ? `UC-${r.usecaseId}` : '—'}
      </span>,
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
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
        )}>
          {r.passed ? t.passLabel : t.failLabel}
        </span>
      ),
    },
    {
      key: "result",
      header: t.colSegment,
      render: r => <span className="text-muted-foreground text-xs">{r.result ?? '—'}</span>,
    },
    {
      key: "date",
      header: t.colDate,
      render: r => <span className="text-muted-foreground text-xs">{r.date}</span>,
    },
  ], [t])

  // ── Pass/fail trend data ──────────────────────────────────────────────────
  const passFailData = trends?.passFailTrend ?? []

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.certTitle} subtitle={t.certSub} />
      <div className="p-6 space-y-6">

        {overviewError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
            {t.errorLoading}: {overviewError}
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent={[
                "from-primary/10 to-primary/5",
                "from-primary/10 to-primary/5",
                "from-primary/10 to-primary/5",
                "from-primary/10 to-primary/5",
              ][i]}
            />
          ))}
        </div>

        {/* Pass/Fail chart */}
        <ChartCard
          title={t.passFailOverTime}
          subtitle={`${t.passFailSub} — ${t.last} ${days} ${t.days}`}
        >
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : passFailData.length === 0
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.noData}</div>
              : <StackedBarChart data={passFailData} />
          }
        </ChartCard>

        {/* Results table */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.evaluationResults}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {resultsLoading
                ? t.loading
                : `${results?.data?.length ?? 0} ${t.evaluationsSub} ${days} ${t.days}`
              }
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {t.sourceCert}
              </span>
            </p>
          </div>
          {resultsLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : <DataTable
                data={results?.data ?? []}
                columns={columns}
                pageSize={10}
              />
          }
        </div>

      </div>
    </div>
  )
}

