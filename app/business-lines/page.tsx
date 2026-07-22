"use client"

import { useMemo } from "react"
import { GitBranch, TrendingUp, Layers } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { MetricCard } from "@/components/MetricCard"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { cn } from "@/lib/utils"
import type { BusinessLinesApiResponse } from "@/lib/types"

interface AccessCaps { hasPharmaAccess?: boolean }

export default function BusinessLinesPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = access?.hasPharmaAccess === true

  const url = ready
    ? buildApiUrl("/api/dashboard/business-lines", dateRange.from, dateRange.to, { rk: refreshKey })
    : null
  const { data, loading } = useApi<BusinessLinesApiResponse>(url)

  const rows = useMemo(
    () => [...(data?.data ?? [])].sort((a, b) => (b.avgScore ?? 0) - (a.avgScore ?? 0)),
    [data]
  )
  const activeCount = rows.filter(r => r.simCount > 0).length
  const best = rows.find(r => r.avgScore != null) ?? null

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.blTitle} subtitle={t.blSub} showModuleFilter={false} />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6 max-w-[1400px] mx-auto">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-[16px] bg-muted/50 animate-pulse" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <GitBranch className="w-10 h-10 opacity-25 mb-3" />
            <p className="text-sm">{t.noDataAvailable}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard label={t.blTotalLines}  value={rows.length}                       icon={<GitBranch className="w-4 h-4" />} />
              <MetricCard label={t.blActiveLines} value={activeCount}                        icon={<Layers className="w-4 h-4" />} />
              <MetricCard label={t.blBestLine}    value={best?.name ?? "—"} unit={best?.avgScore != null ? `· ${Math.round(best.avgScore)}%` : ""} icon={<TrendingUp className="w-4 h-4" />} />
            </div>

            <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 text-left font-semibold">{t.blLine}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t.blMembers}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t.blActiveUsers}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t.blSims}</th>
                      <th className="px-4 py-3 text-right font-semibold">{t.blAvgScore}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const score = r.avgScore != null ? Math.round(r.avgScore) : null
                      return (
                        <tr key={r.tagId} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 font-medium text-foreground capitalize">{r.name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.memberCount}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.activeUsers}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.simCount}</td>
                          <td className={cn("px-4 py-3 text-right font-bold tabular-nums", score == null ? "text-muted-foreground" : score >= 70 ? "text-emerald-600 dark:text-emerald-400" : score >= 40 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400")}>
                            {score != null ? `${score}%` : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
