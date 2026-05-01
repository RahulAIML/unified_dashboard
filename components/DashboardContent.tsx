"use client"

import { useMemo, useEffect, useReducer, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Target, PlayCircle, TrendingUp, BadgeCheck, BarChart2, AlertTriangle, Trophy } from "lucide-react"
import { DashboardHeader }    from "@/components/DashboardHeader"
import { SummaryCard }        from "@/components/SummaryCard"
import { ChartCard }          from "@/components/ChartCard"
import { ActivityLineChart }  from "@/components/charts/ActivityLineChart"
import { ModuleBarChart }     from "@/components/charts/ModuleBarChart"
import { DonutChart }         from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { useDashboardStore }  from "@/lib/store"
import { useT }               from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useCombinedExport } from "@/lib/hooks/useCombinedExport"
import { calcDeltaPct, estimatePassedSessions } from "@/lib/kpi-builder"
import { cn }                 from "@/lib/utils"
import { csvFilename } from "@/lib/csv-export"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import Link from "next/link"
import { useAuthContext } from "@/components/AuthProvider"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  ResultsApiResponse,
  EvaluationApiRow,
  BestPerformersApiResponse,
  BestPerformerRow,
} from "@/lib/types"
import type { Module } from "@/lib/types"

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
      <div className="h-[3px] bg-primary" />
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
  const t = useT()
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>{message ?? t.noDataAvailable}</span>
    </div>
  )
}

// ── Error banner ──────────────────────────────────────────────────────────────
function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

// ── Animated number ───────────────────────────────────────────────────────────
// ── Page ──────────────────────────────────────────────────────────────────────
export function DashboardContent() {
  const { dateRange, selectedSolution, refreshKey } = useDashboardStore()
  const t           = useT()
  const brand       = useClientBrand()
  const { user }    = useAuthContext()
  const { exportAllSolutions, loading: exportLoading } = useCombinedExport()

  // Shimmer for 400 ms on solution/date change
  const [shimmer, dispatchShimmer] = useReducer((_: boolean, next: boolean) => next, false)
  const prevSolution = useRef<Module | null>(null)

  useEffect(() => {
    if (prevSolution.current === selectedSolution) return
    prevSolution.current = selectedSolution
    dispatchShimmer(true)
    const tid = setTimeout(() => dispatchShimmer(false), 400)
    return () => clearTimeout(tid)
  }, [selectedSolution])

  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  // ── Not linked to organization ────────────────────────────────────────────
  if (user !== null && user.customer_id === 0) {
    return (
      <div className="min-h-screen w-full">
        <DashboardHeader title={t.overviewTitle} subtitle={t.overviewSub} showModuleFilter />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
            <BarChart2 className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-3">{t.notLinkedToOrg}</h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">{t.notLinkedToOrgSub}</p>
          <a
            href="mailto:info@rolplay.ai"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
            style={{ background: brand.primaryColor }}
          >
            {t.notLinkedContact}
          </a>
          <p className="mt-4 text-xs text-muted-foreground">
            {user.email}
          </p>
        </div>
      </div>
    )
  }

  // ── API URLs ──────────────────────────────────────────────────────────────
  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, {
    solution: selectedSolution,
    rk: refreshKey,
  })
  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to, {
    solution: selectedSolution,
    rk: refreshKey,
  })
  const ucUrl = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, {
    solution: selectedSolution,
    rk: refreshKey,
  })
  const resultsUrl = buildApiUrl("/api/dashboard/results", dateRange.from, dateRange.to, {
    limit: 20,
    solution: selectedSolution,
    rk: refreshKey,
  })
  const bestUrl = buildApiUrl("/api/dashboard/best-performers", dateRange.from, dateRange.to, {
    limit: 10,
    solution: selectedSolution,
    rk: refreshKey,
  })

  const { data: overview,    loading: overviewLoading, error: overviewError }  = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,      loading: trendsLoading,   error: trendsError }    = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown, loading: ucLoading,       error: ucError }        = useApi<UsecaseBreakdownApiResponse>(ucUrl)
  const { data: results,     loading: resultsLoading,  error: resultsError }   = useApi<ResultsApiResponse>(resultsUrl)
  const { data: bestPerformers, loading: bestLoading }                         = useApi<BestPerformersApiResponse>(bestUrl)

  const hasOverviewData = overview && overview.totalEvaluations > 0

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpiCards = useMemo(() => {
    if (!hasOverviewData) return []
    const d = calcDeltaPct
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
        delta: d(
          overview!.passedEvaluations,
          estimatePassedSessions(overview!.prevTotalEvaluations, overview!.prevPassRate)
        ),
        tier: "A" as const,
      },
    ]
  }, [overview, hasOverviewData])

  const kpiExportRows = useMemo(() => {
    if (!overview) return []
    return [
      {
        solution: selectedSolution ?? "all",
        from: dateRange.from,
        to: dateRange.to,
        totalEvaluations: overview.totalEvaluations,
        avgScore: overview.avgScore,
        passRate: overview.passRate,
        passedEvaluations: overview.passedEvaluations,
        prevTotalEvaluations: overview.prevTotalEvaluations,
        prevAvgScore: overview.prevAvgScore,
        prevPassRate: overview.prevPassRate,
        deltaTotalEvaluations: calcDeltaPct(overview.totalEvaluations, overview.prevTotalEvaluations),
        deltaAvgScore: calcDeltaPct(overview.avgScore, overview.prevAvgScore, 1),
        deltaPassRate: calcDeltaPct(overview.passRate, overview.prevPassRate, 1),
        deltaPassedEvaluations: calcDeltaPct(
          overview.passedEvaluations,
          estimatePassedSessions(overview.prevTotalEvaluations, overview.prevPassRate)
        ),
      },
    ]
  }, [overview, selectedSolution, dateRange.from, dateRange.to])

  // ── Activity trend ────────────────────────────────────────────────────────
  const activityData = useMemo(
    () => trends?.evalCountTrend ?? [],
    [trends]
  )

  // ── Donut chart ───────────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    if (!ucBreakdown?.data?.length) return []
    return ucBreakdown.data.map((row) => ({
      name:  `UC-${row.usecaseId}`,
      value: row.totalEvaluations,
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
            ? "bg-primary/10 text-primary"
            : "bg-destructive/10 text-destructive"
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

  // Backwards-compatible labels (some deploys may have older translation typings)
  const exportAllLabel = (t as Record<string, string>).exportAll ?? "Export All Solutions"
  const exportingLabel = (t as Record<string, string>).exporting ?? "Exporting…"

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full">
      <DashboardHeader
        title={t.overviewTitle}
        subtitle={t.overviewSub}
        showModuleFilter
      />

      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* Active solution badge */}
        <AnimatePresence>
          {selectedSolution && (
            <motion.div
              key="solution-badge"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 text-sm font-medium text-primary"
            >
              <span
                className="inline-block w-2 h-2 rounded-full bg-primary"
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

        {/* API error banners */}
        {overviewError && <ErrorBanner message={`${t.errorLoading}: ${overviewError}`} />}
        {trendsError   && <ErrorBanner message={`${t.errorLoading} (trends): ${trendsError}`} />}
        {ucError       && <ErrorBanner message={`${t.errorLoading} (breakdown): ${ucError}`} />}
        {resultsError  && <ErrorBanner message={`${t.errorLoading} (results): ${resultsError}`} />}

        {/* KPI export row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:justify-end flex-wrap">
          <button
            onClick={() => exportAllSolutions()}
            disabled={exportLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-transparent text-white transition-all"
            style={{ background: brand.primaryColor, opacity: exportLoading ? 0.7 : 1, cursor: exportLoading ? "not-allowed" : "pointer" }}
            title={exportAllLabel}
          >
            {exportLoading ? exportingLabel : `📊 ${exportAllLabel}`}
          </button>
          <ExportButton
            data={kpiExportRows}
            filename={csvFilename(`kpi-summary-${selectedSolution ?? "all"}`)}
            label={t.exportCurrent}
            columns={[
              { header: "Solution", value: (r) => r.solution },
              { header: "From", value: (r) => r.from },
              { header: "To", value: (r) => r.to },
              { header: "Total Evaluations", value: (r) => r.totalEvaluations },
              { header: "Avg Score", value: (r) => r.avgScore },
              { header: "Pass Rate (%)", value: (r) => r.passRate },
              { header: "Passed Evaluations", value: (r) => r.passedEvaluations },
              { header: "Prev Total Evaluations", value: (r) => r.prevTotalEvaluations },
              { header: "Prev Avg Score", value: (r) => r.prevAvgScore },
              { header: "Prev Pass Rate (%)", value: (r) => r.prevPassRate },
              { header: "Δ Total (%)", value: (r) => r.deltaTotalEvaluations },
              { header: "Δ Avg Score (%)", value: (r) => r.deltaAvgScore },
              { header: "Δ Pass Rate (%)", value: (r) => r.deltaPassRate },
              { header: "Δ Passed (%)", value: (r) => r.deltaPassedEvaluations },
            ]}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
                    <div className="h-[3px] bg-primary" />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">
                      {t.noDataAvailable}
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
                ? <ActivityLineChart data={activityData} label="Evaluations" color={brand.chartColors[0]} />
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
              ? <ModuleBarChart data={moduleBreakdownData} sessionsColor={brand.chartColors[0]} passedColor={brand.chartColors[1]} />
              : <EmptyState />
          }
        </ChartCard>

        {/* Best Performers section — shown when data exists */}
        {(bestLoading || (bestPerformers?.data?.length ?? 0) > 0) && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="w-4 h-4 text-primary" />
                {t.bestPerformers}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.bestPerformersSub} — {t.last} {days} {t.days}
              </p>
            </div>
            {bestLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 animate-pulse">
                    <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-32 rounded bg-muted" />
                      <div className="h-2.5 w-24 rounded bg-muted" />
                    </div>
                    <div className="w-16 h-6 rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {bestPerformers!.data.map((performer, idx) => {
                  // pass_rate comes from SQL as 0-100 already
                  const passRateDisplay = Number(performer.pass_rate).toFixed(1)
                  const avgScoreDisplay = Number(performer.avg_score).toFixed(1)
                  const displayName = performer.user_name?.trim()
                    ? performer.user_name.trim()
                    : performer.user_email

                  return (
                    <div
                      key={`${performer.user_email}-${idx}`}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors gap-2"
                    >
                      {/* Rank + Name */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div
                          className={cn(
                            "flex items-center justify-center w-7 h-7 rounded-full font-bold text-xs shrink-0",
                            idx === 0 ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400"
                            : idx === 1 ? "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                            : idx === 2 ? "bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400"
                            : "bg-primary/10 text-primary"
                          )}
                        >
                          {idx + 1}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
                          {displayName !== performer.user_email && (
                            <p className="text-xs text-muted-foreground truncate">{performer.user_email}</p>
                          )}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-3 sm:gap-5 text-right shrink-0">
                        <div className="hidden sm:block">
                          <p className="text-xs text-muted-foreground">{t.colSessions}</p>
                          <p className="text-sm font-semibold text-foreground tabular-nums">{Number(performer.sessions)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t.avgSessionScore}</p>
                          <p className="text-sm font-semibold text-foreground tabular-nums">{avgScoreDisplay} pts</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t.passRate}</p>
                          <p className="text-sm font-semibold text-primary tabular-nums">{passRateDisplay}%</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Recent evaluations table */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.evaluationResults}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {resultsLoading
                ? t.loading
                : `${results?.data?.length ?? 0} ${t.evaluationsSub} ${days} ${t.days}`}
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {t.liveLabel}
              </span>
            </p>
          </div>
          {resultsLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : results?.data?.length
              ? <DataTable data={results.data} columns={evalColumns} pageSize={10} />
              : <div className="py-10 text-center text-sm text-muted-foreground">{t.noDataAvailable}</div>
          }
        </div>
      </div>
    </div>
  )
}
