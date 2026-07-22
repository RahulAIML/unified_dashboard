"use client"

import { useMemo } from "react"
import { Activity, CheckCircle2, XCircle } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { cn } from "@/lib/utils"
import type { UsecaseBreakdownApiResponse } from "@/lib/types"

interface AccessCaps { hasCoachData?: boolean; hasPharmaAccess?: boolean; hasBancoAccess?: boolean }

function scoreColor(pct: number): string {
  if (pct >= 70) return "text-emerald-600 dark:text-emerald-400"
  if (pct >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

export default function ActivitiesPage() {
  const { dateRange, selectedSolution, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = !!(access?.hasCoachData || access?.hasPharmaAccess || access?.hasBancoAccess)

  const url = ready
    ? buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
    : null
  const { data, loading } = useApi<UsecaseBreakdownApiResponse>(url)

  const rows = useMemo(
    () => [...(data?.data ?? [])].sort((a, b) => b.totalEvaluations - a.totalEvaluations),
    [data]
  )

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.actTitle} subtitle={t.actSub} showModuleFilter />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 max-w-[1400px] mx-auto">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-40 rounded-[16px] bg-muted/50 animate-pulse" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <Activity className="w-10 h-10 opacity-25 mb-3" />
            <p className="text-sm">{t.noDataAvailable}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((r) => {
              const avg  = r.avgScore != null ? Math.round(r.avgScore) : null
              const rate = r.passRate != null ? Math.round(r.passRate) : null
              const failed = Math.max(r.totalEvaluations - r.passed, 0)
              return (
                <div key={r.usecaseId} className="rounded-[16px] border border-border/60 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.06)] transition-all duration-200">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Activity className="w-4 h-4" />
                    </div>
                    <p className="text-sm font-semibold text-foreground truncate">{r.usecase_name?.trim() || `UC-${r.usecaseId}`}</p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xl font-bold tabular-nums text-foreground">{r.totalEvaluations}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{t.actSessions}</p>
                    </div>
                    <div>
                      <p className={cn("text-xl font-bold tabular-nums", avg == null ? "text-muted-foreground" : scoreColor(avg))}>{avg != null ? `${avg}%` : "—"}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{t.actAvgScore}</p>
                    </div>
                    <div>
                      <p className={cn("text-xl font-bold tabular-nums", rate == null ? "text-muted-foreground" : scoreColor(rate))}>{rate != null ? `${rate}%` : "—"}</p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{t.actApprovalRate}</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {r.passed}
                    </span>
                    <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                      <XCircle className="w-3.5 h-3.5" /> {failed}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
