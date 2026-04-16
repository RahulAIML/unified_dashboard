"use client"

import { useMemo, useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Target, PlayCircle, Award, TrendingUp, BadgeCheck, BarChart2 } from "lucide-react"
import { DashboardHeader }    from "@/components/DashboardHeader"
import { SummaryCard }        from "@/components/SummaryCard"
import { ChartCard }          from "@/components/ChartCard"
import { ActivityLineChart }  from "@/components/charts/ActivityLineChart"
import { ModuleBarChart }     from "@/components/charts/ModuleBarChart"
import { DonutChart }         from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
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
  ResultsApiResponse,
  EvaluationApiRow,
} from "@/lib/types"
import type { Module } from "@/lib/types"

// ── Donut colour palette ──────────────────────────────────────────────────────
const DONUT_COLORS = brand.chartColors

// ── KPI icons ─────────────────────────────────────────────────────────────────
const kpiIcons = [
  <PlayCircle key="p"  className="w-4 h-4" />,
  <Target     key="t"  className="w-4 h-4" />,
  <TrendingUp key="tr" className="w-4 h-4" />,
  <BadgeCheck key="b"  className="w-4 h-4" />,
]

// ── Skeleton shimmer ──────────────────────────────────────────────────────────
function KpiSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="h-[3px]" style={{ background: brand.primaryColor }} />
      <div className="p-5 space-y-3 animate-pulse">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-8 w-20 rounded bg-muted" />
        <div className="h-2.5 w-16 rounded bg-muted" />
      </div>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({ message }: { message?: string }) {
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>{message ?? "No data available"}</span>
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

  // Shimmer for 400 ms on solution/date change
  const [shimmer, setShimmer] = useState(false)
  const prevSolution = useRef<Module | null>(null)

  useEffect(() => {
    if (prevSolution.current === selectedSolution) return
    prevSolution.current = selectedSolution
    setShimmer(true)
    const tid = setTimeout(() => setShimmer(false), 400)
    return () => clearTimeout(tid)
  }, [selectedSolution])

  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  // ── API URLs ──────────────────────────────────────────────────────────────
  const solutionParam = selectedSolution ? `&solution=${selectedSolution}` : ""

  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to) + solutionParam
  const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to) + solutionParam
  const ucUrl       = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to) + solutionParam
  const resultsUrl  = buildApiUrl("/api/dashboard/results",  dateRange.from, dateRange.to, { limit: "20" }) + solutionParam

  const { data: overview,   loading: overviewLoading }   = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,     loading: trendsLoading }      = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown, loading: ucLoading }         = useApi<UsecaseBreakdownApiResponse>(ucUrl)
  const { data: results,    loading: resultsLoading }     = useApi<ResultsApiResponse>(resultsUrl)

  const hasOverviewData = overview && overview.totalEvaluations > 0

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpiCards = useMemo(() => {
    if (!hasOverviewData) return []
    const d = calcDelta
    return [
      {
        label: "Practice Sessions", labelKey: "practiceSessions" as const,
        value: overview!.totalEvaluations,
        delta: d(overview!.totalEvaluations, overview!.prevTotalEvaluations),
        tier: "A" as const,
      },
      {
        label: "Avg Session Score", labelKey: "avgSessionScore" as const,
        value: overview!.avgScore ?? 0, unit: "pts",
        delta: d(overview!.avgScore ?? 0, overview!.prevAvgScore ?? 0),
        tier: "B" as const,
      },
      {
        label: "Overall Pass Rate", labelKey: "overallPassRate" as const,
        value: overview!.passRate ?? 0, unit: "%",
        delta: d(overview!.passRate ?? 0, overview!.prevPassRate ?? 0),
        tier: "B" as const,
      },
      {
        label: "Certified Users", labelKey: "certifiedUsers" as const,
        value: overview!.passedEvaluations,
        delta: d(overview!.passedEvaluations,
          overview!.prevTotalEvaluations > 0
            ? Math.round(overview!.prevTotalEvaluations * (overview!.prevPassRate ?? 0) / 100)
            : 0),
        tier: "A" as const,
      },
    ]
  }, [overview, hasOverviewData])

  // ── Activity trend ────────────────────────────────────────────────────────
  const activityData = useMemo(
    () => trends?.evalCountTrend ?? [],
    [trends]
  )

  // ── Donut chart ───────────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    if (!ucBreakdown?.data?.length) return []
    return ucBreakdown.data.map((row, i) => ({
      name:  `UC-${row.usecaseId}`,
      value: row.totalEvaluations,
      color: DONUT_COLORS[i % DONUT_COLORS.length],
    }))
  }, [ucBreakdown])

  // ── Bar chart ─────────────────────────────────────────────────────────────
  const moduleBreakdownData = useMemo(() => {
    if (!ucBreakdown?.data?.length) return []
    return ucBreakdown.data.map(row => ({
      module:   `UC-${row.usecaseId}`,
      sessions: row.totalEvaluations,
      passed:   row.passed,
    }))
  }, [ucBreakdown])

  // ── Evaluation results table columns ─────────────────────────────────────
  const evalColumns: Column<EvaluationApiRow>[] = [
    {
      key: "savedReportId",
      header: t.colReportId,
      render: r => <span className="font-medium font-mono text-xs">#{r.savedReportId}</span>,
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
      header: t.colAvgScore,
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
      key: "date",
      header: t.colDate,
      render: r => <span className="text-muted-foreground text-xs">{r.date}</span>,
    },
  ]

  const isLoading = overviewLoading || shimmer

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
                style={{ background: brand.primaryColor }}
              />
              {t.themeShowing}{" "}
              <span className="capitalize font-bold">
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

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
            : kpiCards.length > 0
              ? kpiCards.map((kpi, i) => (
                  <SummaryCard
                    key={`${selectedSolution ?? "all"}-${kpi.label}`}
                    kpi={kpi}
                    index={i}
                    icon={kpiIcons[i]}
                  />
                ))
              : Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
                  >
                    <div className="h-[3px]" style={{ background: brand.primaryColor }} />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">
                      No data available
                    </div>
                  </div>
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
            {shimmer || trendsLoading
              ? <div className="h-48 animate-pulse rounded-lg bg-muted" />
              : activityData.length > 0
                ? <ActivityLineChart data={activityData} label="Evaluations" />
                : <EmptyState />
            }
          </ChartCard>
          <ChartCard
            title={t.moduleDistribution}
            subtitle={`${t.moduleDistSub} — ${days}d`}
          >
            {shimmer || ucLoading
              ? <div className="h-48 animate-pulse rounded-lg bg-muted" />
              : donutData.length > 0
                ? <DonutChart data={donutData} />
                : <EmptyState />
            }
          </ChartCard>
        </div>

        <ChartCard
          title={t.sessionsByModule}
          subtitle={`${t.sessionsByModuleSub} — ${t.last} ${days} ${t.days}`}
        >
          {shimmer || ucLoading
            ? <div className="h-48 animate-pulse rounded-lg bg-muted" />
            : moduleBreakdownData.length > 0
              ? <ModuleBarChart data={moduleBreakdownData} />
              : <EmptyState />
          }
        </ChartCard>

        {/* Recent evaluations table */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.evaluationResults}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {resultsLoading
                ? t.loading
                : `${results?.data?.length ?? 0} ${t.evaluationsSub} ${days} ${t.days}`}
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                Live
              </span>
            </p>
          </div>
          {resultsLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : results?.data?.length
              ? <DataTable data={results.data} columns={evalColumns} pageSize={10} />
              : <div className="py-10 text-center text-sm text-muted-foreground">No data available</div>
          }
        </div>
      </div>
    </div>
  )
}
