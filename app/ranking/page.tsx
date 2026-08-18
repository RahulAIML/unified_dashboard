"use client"

/**
 * Dedicated Ranking / leaderboard page — matches the reference standalone
 * dashboards' "Clasificación" nav item (docs/sanfer-dashboard-inventory.md),
 * which give the leaderboard both a summary card on Overview AND its own
 * full page. Reuses the SAME /api/dashboard/best-performers endpoint
 * Overview's own card already calls — same real data, just a fuller list
 * (up to 20, vs Overview's 10) and its own page instead of one card among
 * many. That endpoint already has a real branch for every org type (banco/
 * pharma/rolplay-app/analytics), so this page works for any of them, not
 * just rolplay-app — Sidebar.tsx gates it the same way as Activities/Reports.
 */

import { AlertTriangle, Trophy, TrendingUp, TrendingDown } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { cn } from "@/lib/utils"
import type { BestPerformersApiResponse, BestPerformerRow } from "@/lib/types"

interface AccessCaps { hasCoachData?: boolean; hasPharmaAccess?: boolean; hasBancoAccess?: boolean; hasRolplayAppAccess?: boolean }

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

const RANK_BADGE_CLASSES = [
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 shadow-sm",
  "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 shadow-sm",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 shadow-sm",
]

export default function RankingPage() {
  const { dateRange, selectedSolution, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = !!(access?.hasCoachData || access?.hasPharmaAccess || access?.hasBancoAccess || access?.hasRolplayAppAccess)

  const url = ready
    ? buildApiUrl("/api/dashboard/best-performers", dateRange.from, dateRange.to, { limit: 20, solution: selectedSolution, rk: refreshKey })
    : null
  const { data, loading, error } = useApi<BestPerformersApiResponse>(url)
  const rows = data?.data ?? []

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.navRanking} subtitle={t.bestPerformersSub} showModuleFilter />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 max-w-[1400px] mx-auto">
        {/* Was silently dropped: a backend/tenant-resolution failure rendered
            identically to a real "no performers yet" tenant (rows=[] either
            way). Surfacing it distinguishes "something broke" from "empty". */}
        {error && <ErrorBanner message={`${t.errorLoading}: ${error}`} />}
        <div className="rounded-[16px] border border-border/60 bg-card p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="mb-5">
            <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, hsl(var(--primary)/0.12), hsl(var(--accent)/0.08))" }}
              >
                <Trophy className="w-4 h-4 text-primary" />
              </div>
              {t.bestPerformers}
            </h3>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-4 rounded-xl bg-muted/40 animate-pulse">
                  <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-36 rounded bg-muted" />
                    <div className="h-3 w-28 rounded bg-muted/70" />
                  </div>
                  <div className="w-20 h-7 rounded-lg bg-muted" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <Trophy className="w-10 h-10 opacity-25 mb-3" />
              <p className="text-sm">{t.noDataAvailable}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((performer: BestPerformerRow, idx: number) => {
                const passRateDisplay = Number(performer.pass_rate).toFixed(1)
                const avgScoreDisplay = Number(performer.avg_score).toFixed(1)
                const displayName = performer.user_name?.trim() ? performer.user_name.trim() : performer.user_email
                const goodPassRate = performer.pass_rate >= 50
                return (
                  <div
                    key={`${performer.user_email}-${idx}`}
                    className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-all duration-200 gap-3"
                  >
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                      <div
                        className={cn(
                          "flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl font-bold text-xs sm:text-sm shrink-0",
                          RANK_BADGE_CLASSES[idx] ?? "bg-primary/10 text-primary"
                        )}
                      >
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-semibold text-foreground truncate">{displayName}</p>
                        {displayName !== performer.user_email && (
                          <p className="text-xs text-muted-foreground truncate">{performer.user_email}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-6 text-right shrink-0">
                      <div className="hidden sm:block">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.colSessions}</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{Number(performer.sessions)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.avgSessionScore}</p>
                        <p className="text-sm font-bold text-foreground tabular-nums">{avgScoreDisplay} <span className="text-xs font-normal text-muted-foreground">pts</span></p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.passRate}</p>
                        <p className={cn(
                          "text-sm font-bold tabular-nums inline-flex items-center gap-1",
                          goodPassRate ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                        )}>
                          {goodPassRate ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {passRateDisplay}%
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
