"use client"

import { useMemo } from "react"
import { TrendingUp, AlertTriangle, Lightbulb, Gamepad2, CheckCircle, Star, Target } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { calcDeltaPct } from "@/lib/kpi-builder"
import { csvFilename } from "@/lib/csv-export"
import { cn } from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  BestPerformersApiResponse,
  ObjectionsApiResponse,
  ObjectionRow,
  ResultsApiResponse,
} from "@/lib/types"

const kpiIcons = [
  <Gamepad2    key="g" className="w-4 h-4" />,
  <CheckCircle key="c" className="w-4 h-4" />,
  <Star        key="s" className="w-4 h-4" />,
  <Target      key="t" className="w-4 h-4" />,
]

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

/** Mini pass-rate bar shown inside table cells */
function PassRateBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "bg-primary"
    : value >= 50 ? "bg-amber-500"
    : "bg-destructive"
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold min-w-[44px] justify-center",
        value >= 70 ? "bg-primary/10 text-primary"
          : value >= 50 ? "bg-amber-500/10 text-amber-600"
          : "bg-destructive/10 text-destructive"
      )}>
        {value}%
      </span>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  )
}

export default function CoachPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t = useT()
  const brand = useClientBrand()

  const overviewUrl    = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: "coach", rk: refreshKey })
  const trendsUrl      = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to, { solution: "coach", rk: refreshKey })
  const ucUrl          = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: "coach", rk: refreshKey })
  const bestUrl        = buildApiUrl("/api/dashboard/best-performers",   dateRange.from, dateRange.to, { limit: 50, solution: "coach", rk: refreshKey })
  const objectionsUrl  = buildApiUrl("/api/dashboard/objections", dateRange.from, dateRange.to, { rk: refreshKey })
  // Internal/temporary, KPI-design evaluation only (see the export card
  // below): raw per-session rows, the same data /api/dashboard/results
  // already serves for Certification's "Evaluation Results" table.
  const resultsUrl     = buildApiUrl("/api/dashboard/results", dateRange.from, dateRange.to, { limit: 200, solution: "coach", rk: refreshKey })

  const { data: overview, loading: overviewLoading, error: overviewError } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,   loading: trendsLoading }           = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown,    loading: ucLoading }         = useApi<UsecaseBreakdownApiResponse>(ucUrl)
  const { data: bestPerformers, loading: bestLoading, error: bestError } = useApi<BestPerformersApiResponse>(bestUrl)
  const { data: objections,     loading: objectionsLoading } = useApi<ObjectionsApiResponse>(objectionsUrl)
  const { data: rawResults }                                 = useApi<ResultsApiResponse>(resultsUrl)

  const loading = ucLoading || bestLoading
  const hasData = (bestPerformers?.data?.length ?? 0) > 0 || (ucBreakdown?.data?.length ?? 0) > 0
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  // Master Coach is a SIMULATOR VARIANT, not an advice product: in the platform
  // schema it is r_simulator.category = 'COACH', so it produces scored practice
  // sessions exactly like SIM does. It therefore gets the same session metrics.
  //
  // This page previously omitted them on purpose, reasoning that repeating
  // headline totals would make every tab look identical. That worry does not
  // apply: every request here is scoped to solution=coach, so these are
  // coach-only figures, NOT the Simulator numbers repeated. Showing a scored
  // module with no scores was the bigger problem — it made a practice module
  // read as a page of advice.
  //
  // The coaching insights below are kept: they are still the actionable part,
  // now sitting under the module's actual performance rather than standing in
  // for it.
  const kpis = useMemo(() => {
    if (!overview || overview.totalEvaluations === 0) return []
    return [
      {
        label: "Total Sessions", labelKey: "totalSessions" as const,
        value: overview.totalEvaluations,
        delta: calcDeltaPct(overview.totalEvaluations, overview.prevTotalEvaluations),
        tier: "A" as const,
        info: t.totalSessionsInfo,
      },
      {
        label: "Pass Rate", labelKey: "passRate" as const,
        // Was `?? 0`: a module with zero SCORED sessions this period showed a
        // literal "0%" pass-rate tile indistinguishable from a real all-fail
        // period, and the delta compared two fabricated zeros. passRate is
        // only ever null when there is nothing to compute a rate from.
        value: overview.passRate ?? "—",
        unit: overview.passRate != null ? "%" : undefined,
        delta: overview.passRate != null && overview.prevPassRate != null
          ? calcDeltaPct(overview.passRate, overview.prevPassRate) : 0,
        noComparison: overview.passRate == null || overview.prevPassRate == null,
        tier: "B" as const,
        info: t.passRateInfo,
      },
      {
        label: "Avg Score", labelKey: "avgScore" as const,
        // Same null-vs-zero fix as Pass Rate above.
        value: overview.avgScore ?? "—",
        unit: overview.avgScore != null ? "pts" : undefined,
        delta: overview.avgScore != null && overview.prevAvgScore != null
          ? calcDeltaPct(overview.avgScore, overview.prevAvgScore) : 0,
        noComparison: overview.avgScore == null || overview.prevAvgScore == null,
        tier: "B" as const,
        info: t.avgScoreInfo,
      },
      {
        label: "Successful Sessions", labelKey: "successfulSessions" as const,
        value: overview.passedEvaluations,
        delta: calcDeltaPct(overview.passedEvaluations, overview.prevTotalEvaluations),
        tier: "A" as const,
        info: t.successfulSessionsInfo,
      },
    ]
  }, [overview, t])

  const activityData   = useMemo(() => trends?.evalCountTrend ?? [], [trends])
  const scoreTrendData = useMemo(() => trends?.scoreTrend ?? [],     [trends])

  const strengths = useMemo(
    () => [...(bestPerformers?.data ?? [])].sort((a, b) => b.avg_score - a.avg_score).slice(0, 5),
    [bestPerformers],
  )
  const improvementAreas = useMemo(
    () => [...(bestPerformers?.data ?? [])].filter(u => u.avg_score < 60).sort((a, b) => a.avg_score - b.avg_score).slice(0, 5),
    [bestPerformers],
  )
  const weakUsecases = useMemo(
    () => (ucBreakdown?.data ?? []).filter(u => (u.passRate ?? 100) < 60).slice(0, 3),
    [ucBreakdown],
  )
  const teamAvgScore = useMemo(() => {
    const rows = bestPerformers?.data ?? []
    if (!rows.length) return null
    return Math.round((rows.reduce((s, r) => s + r.avg_score, 0) / rows.length) * 10) / 10
  }, [bestPerformers])

  const objectionColumns: Column<ObjectionRow>[] = useMemo(() => [
    {
      key: "objectionText", header: t.colObjectionText,
      render: r => (
        <div className="max-w-md space-y-1.5 py-1">
          <span className="text-sm block whitespace-normal break-words">{r.objectionText}</span>
          {r.topAnswers.length > 0 && (
            <ul className="space-y-0.5">
              {r.topAnswers.slice(0, 3).map((a, i) => (
                <li key={i} className="text-xs text-muted-foreground italic whitespace-normal break-words">
                  &ldquo;{a.text}&rdquo; <span className="not-italic font-medium">— {a.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
    { key: "count", header: t.colTimesEncountered, render: r => <span className="tabular-nums font-medium">{r.count}</span> },
    { key: "passRate", header: t.colSuccessRate, render: r => <PassRateBar value={r.passRate} /> },
  ], [t])

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.coachTitle} subtitle={t.coachSub} />
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {(overviewError || bestError) && (
          <ErrorBanner message={`${t.errorLoading}: ${overviewError || bestError}`} />
        )}

        {/* Session metrics — coach-scoped, because Master Coach is a scored
            simulator variant (r_simulator.category = 'COACH'). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {overviewLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                  <div className="h-[3px] bg-primary" />
                  <div className="p-5 space-y-3 animate-pulse">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-8 w-20 rounded bg-muted" />
                    <div className="h-5 w-16 rounded bg-muted" />
                  </div>
                </div>
              ))
            : kpis.length > 0
              ? kpis.map((kpi, i) => <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={kpiIcons[i]} />)
              : Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="h-[3px] bg-primary" />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">{t.noDataAvailable}</div>
                  </div>
                ))
          }
        </div>

        {/* Trends — same pair the Simulator page shows, scoped to coach. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <ChartCard title={t.activityTrend} subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}>
            {trendsLoading
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : activityData.length > 0
                ? <ActivityLineChart data={activityData} label={t.journeySessions} color={brand.chartColors[0]} />
                : <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.noDataAvailable}</div>
            }
          </ChartCard>
          <ChartCard title={t.scoreTrend} subtitle={`${t.last} ${days} ${t.days}`}>
            {trendsLoading
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : scoreTrendData.length > 0
                ? <ActivityLineChart data={scoreTrendData} label={t.avgScore} color={brand.chartColors[1] ?? brand.chartColors[0]} />
                : <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.noDataAvailable}</div>
            }
          </ChartCard>
        </div>

        {/* Coaching insights — the actionable layer, derived from the same rows,
            now sitting UNDER the module's own performance instead of replacing it. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="rounded-xl border border-border bg-card shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">{t.coachingStrengths}</h3>
            </div>
            {loading
              ? <div className="py-8 text-center text-sm text-muted-foreground">{t.loading}</div>
              : strengths.length > 0
                ? (
                  <div className="space-y-2">
                    {strengths.map(u => (
                      <div key={u.user_email} className="flex items-center justify-between p-2 rounded-lg bg-primary/5 border border-primary/10">
                        <span className="text-xs truncate flex-1 min-w-0">{u.user_name || u.user_email}</span>
                        <span className="text-xs font-bold text-primary">{u.avg_score}%</span>
                      </div>
                    ))}
                  </div>
                )
                : <p className="text-xs text-muted-foreground text-center py-4">{t.coachingNoData}</p>
            }
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold">{t.coachingImprove}</h3>
            </div>
            {loading
              ? <div className="py-8 text-center text-sm text-muted-foreground">{t.loading}</div>
              : improvementAreas.length > 0
                ? (
                  <div className="space-y-2">
                    {improvementAreas.map(u => (
                      <div key={u.user_email} className="flex items-center justify-between p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                        <span className="text-xs truncate flex-1 min-w-0">{u.user_name || u.user_email}</span>
                        <span className="text-xs font-bold text-amber-600">{u.avg_score}%</span>
                      </div>
                    ))}
                  </div>
                )
                : <p className="text-xs text-muted-foreground text-center py-4">{hasData ? t.coachingAllAbove : t.coachingNoData}</p>
            }
          </div>

          <div className="rounded-xl border border-border bg-card shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-4 h-4 text-accent" />
              <h3 className="text-sm font-semibold">{t.coachingTips}</h3>
            </div>
            {loading
              ? <div className="py-8 text-center text-sm text-muted-foreground">{t.loading}</div>
              : !hasData
                ? <p className="text-xs text-muted-foreground text-center py-4">{t.coachingNoData}</p>
                : (
                  <div className="space-y-2 text-xs text-muted-foreground">
                    {weakUsecases.length > 0 && (
                      <p>{t.coachingTipWeakUc} {weakUsecases.map(u => u.usecase_name || `UC-${u.usecaseId}`).join(', ')}.</p>
                    )}
                    {teamAvgScore != null && (
                      <p>{t.coachingTipAvgScore} {teamAvgScore}{t.coachingTipAvgScore2} {Math.min(100, Math.round(teamAvgScore + 10))}%.</p>
                    )}
                  </div>
                )
            }
          </div>
        </div>

        {/* Objection Handling — only rendered when a tenant has real objection-handling data */}
        {(objectionsLoading || (objections?.data?.length ?? 0) > 0) && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">{t.objections}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{t.objectionsSub}</p>
              </div>
              <ExportButton
                data={objections?.data ?? []}
                filename={csvFilename("objections")}
                columns={[
                  { header: "Objection",         value: r => r.objectionText },
                  { header: "Times Encountered", value: r => r.count },
                  { header: "Success Rate (%)",  value: r => r.passRate },
                  { header: "Model Answer",      value: r => r.modelAnswer ?? "" },
                ]}
              />
            </div>
            <div className="p-5">
              {objectionsLoading
                ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
                : <DataTable data={objections!.data} columns={objectionColumns} pageSize={10} />
              }
            </div>
          </div>
        )}

        {/* Internal/temporary: raw per-session export for KPI-design
            evaluation (Aug 20/21 sprint review) -- lets an admin download
            the exact rows a KPI/chart on this page is computed from. To be
            removed once that evaluation is done, matching Certification's
            existing "Evaluation Results" export. */}
        {!!rawResults?.data?.length && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">{t.rawExportTitle}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{rawResults.data.length} {t.rawExportSub}</p>
              </div>
              <ExportButton
                data={rawResults.data}
                filename={csvFilename("coach-raw-sessions")}
                label={t.rawExportLabel}
                columns={[
                  { header: "Report ID",   value: r => r.savedReportId },
                  { header: "Use Case ID", value: r => r.usecaseId },
                  { header: "Score",       value: r => r.score },
                  { header: "Result",      value: r => r.passed == null ? "" : r.passed ? "PASS" : "FAIL" },
                  { header: "Date",        value: r => r.date },
                ]}
              />
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
