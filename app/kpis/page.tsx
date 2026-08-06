"use client"

/**
 * KPIs page — Sugerencia de KPI's Cesar.xlsx, ported to the hand-built
 * dashboard. rolplay-app only (see /api/dashboard/cesar-kpis and
 * lib/bridge-rolplay-app.ts's Cesar KPI functions for the full per-KPI
 * feasibility notes — 13 of 19 KPIs implemented, 6 documented as not
 * computable without fabricating data the platform never recorded).
 */

import { useMemo } from "react"
import {
  UserCheck, Repeat, CalendarClock, Target, TrendingUp as TrendUpIcon,
  ShieldCheck, Compass, Award, ThumbsUp, ThumbsDown, AlertTriangle,
} from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { MetricCard } from "@/components/MetricCard"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { cn } from "@/lib/utils"

interface AccessCaps { hasRolplayAppAccess?: boolean }

interface CesarKpisResponse {
  activationRate: number | null
  weeklyPracticeFrequency: number | null
  mauRate: number | null
  practicesToMastery: number | null
  deltaScore: number | null
  readinessIndex: number | null
  trialAndErrorRate: number | null
  masteryDistribution: { label: string; value: number; pct: number }[]
  adoptionMovementRate: number | null
  commercialDomain: { domain: string; avgScore: number; sessions: number }[]
  topStrengths: { item: string; count: number }[]
  topOpportunities: { item: string; count: number }[]
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v}%`
}
function fmtNum(v: number | null): string {
  return v == null ? "—" : `${v}`
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-border/60 bg-card p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

export default function KpisPage() {
  const { dateRange, selectedSolution, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = !!access?.hasRolplayAppAccess

  const url = ready
    ? buildApiUrl("/api/dashboard/cesar-kpis", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
    : null
  const { data, loading } = useApi<CesarKpisResponse>(url)

  const cards = useMemo(() => ([
    { key: "activation", label: t.kpiActivationRate, value: fmtPct(data?.activationRate ?? null), icon: <UserCheck className="w-4 h-4" /> },
    { key: "weekly", label: t.kpiWeeklyPractice, value: fmtNum(data?.weeklyPracticeFrequency ?? null), icon: <Repeat className="w-4 h-4" /> },
    { key: "mau", label: t.kpiMau, value: fmtPct(data?.mauRate ?? null), icon: <CalendarClock className="w-4 h-4" /> },
    { key: "practices", label: t.kpiPracticesToMastery, value: fmtNum(data?.practicesToMastery ?? null), icon: <Target className="w-4 h-4" /> },
    { key: "delta", label: t.kpiDeltaScore, value: data?.deltaScore != null ? `${data.deltaScore > 0 ? "+" : ""}${data.deltaScore}` : "—", icon: <TrendUpIcon className="w-4 h-4" /> },
    { key: "readiness", label: t.kpiReadinessIndex, value: fmtPct(data?.readinessIndex ?? null), icon: <ShieldCheck className="w-4 h-4" /> },
    { key: "trialAndError", label: t.kpiTrialAndError, value: fmtPct(data?.trialAndErrorRate ?? null), icon: <AlertTriangle className="w-4 h-4" /> },
  ]), [data, t])

  if (!ready) {
    return (
      <div className="min-h-screen w-full">
        <DashboardHeader title={t.navKpis} subtitle="" />
        <div className="w-full px-4 sm:px-6 lg:px-8 py-16 text-center text-muted-foreground">{t.noDataAvailable}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.navKpis} subtitle={t.kpisSubtitle} showModuleFilter />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 max-w-[1400px] mx-auto space-y-5">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 rounded-[16px] bg-muted/50 animate-pulse" />)}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cards.map(c => <MetricCard key={c.key} label={c.label} value={c.value} icon={c.icon} />)}
            </div>

            <SectionCard title={t.kpiMasteryDistTitle} subtitle={t.kpiMasteryDistSub}>
              {(data?.masteryDistribution?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
              ) : (
                <div className="space-y-2">
                  {data!.masteryDistribution.map(b => (
                    <div key={b.label} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{b.label}</span>
                      <div className="flex-1 h-5 bg-muted/40 rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, b.pct)}%` }} />
                      </div>
                      <span className="w-20 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">{b.value} ({b.pct}%)</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MetricCard label={t.kpiAdoptionMovement} value={fmtPct(data?.adoptionMovementRate ?? null)} icon={<Compass className="w-4 h-4" />}
                hint={t.kpiAdoptionMovementHint} />

              <SectionCard title={t.kpiCommercialDomainTitle} subtitle={t.kpiCommercialDomainSub}>
                {(data?.commercialDomain?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
                ) : (
                  <div className="space-y-2">
                    {data!.commercialDomain.map(d => (
                      <div key={d.domain} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{d.domain}</span>
                        <span className={cn(
                          "font-semibold tabular-nums",
                          d.avgScore >= 70 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                        )}>{d.avgScore} pts <span className="text-xs text-muted-foreground font-normal">({d.sessions})</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SectionCard title={t.kpiTopStrengthsTitle} subtitle={t.kpiTopStrengthsSub}>
                {(data?.topStrengths?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
                ) : (
                  <ul className="space-y-2">
                    {data!.topStrengths.map(s => (
                      <li key={s.item} className="flex items-start gap-2 text-sm">
                        <ThumbsUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <span className="text-foreground flex-1">{s.item}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{s.count}×</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>

              <SectionCard title={t.kpiTopOpportunitiesTitle} subtitle={t.kpiTopOpportunitiesSub}>
                {(data?.topOpportunities?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
                ) : (
                  <ul className="space-y-2">
                    {data!.topOpportunities.map(s => (
                      <li key={s.item} className="flex items-start gap-2 text-sm">
                        <ThumbsDown className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                        <span className="text-foreground flex-1">{s.item}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{s.count}×</span>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
