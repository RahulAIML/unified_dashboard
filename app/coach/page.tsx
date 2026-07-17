"use client"

import { useMemo } from "react"
import { TrendingUp, AlertTriangle, Lightbulb } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDeltaPct } from "@/lib/kpi-builder"
import { csvFilename } from "@/lib/csv-export"
import { cn } from "@/lib/utils"
import type {
  UsecaseBreakdownApiResponse,
  BestPerformersApiResponse,
  ObjectionsApiResponse,
  ObjectionRow,
} from "@/lib/types"

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

  const ucUrl          = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: "coach", rk: refreshKey })
  const bestUrl        = buildApiUrl("/api/dashboard/best-performers",   dateRange.from, dateRange.to, { limit: 50, solution: "coach", rk: refreshKey })
  const objectionsUrl  = buildApiUrl("/api/dashboard/objections", dateRange.from, dateRange.to, { rk: refreshKey })

  const { data: ucBreakdown,    loading: ucLoading }         = useApi<UsecaseBreakdownApiResponse>(ucUrl)
  const { data: bestPerformers, loading: bestLoading, error: bestError } = useApi<BestPerformersApiResponse>(bestUrl)
  const { data: objections,     loading: objectionsLoading } = useApi<ObjectionsApiResponse>(objectionsUrl)

  const loading = ucLoading || bestLoading
  const hasData = (bestPerformers?.data?.length ?? 0) > 0 || (ucBreakdown?.data?.length ?? 0) > 0

  // Same underlying session data as Simulator — this page deliberately does
  // NOT repeat those headline totals (that read as "the dashboard is broken,
  // every tab looks the same"). Instead it surfaces coaching-actionable
  // insights derived from the same rows, matching the real Sanfer product's
  // own Coaching page (top performers / improvement areas / focus areas),
  // not a second copy of the KPI tiles.
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

        {bestError && <ErrorBanner message={`${t.errorLoading}: ${bestError}`} />}

        {/* Coaching insights — derived from the same session data as Simulator,
            presented as actionable coaching content instead of duplicate KPI tiles */}
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

      </div>
    </div>
  )
}
