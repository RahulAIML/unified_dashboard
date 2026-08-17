"use client"

/**
 * KPIs page — Sugerencia de KPI's Cesar.xlsx, ported to the hand-built
 * dashboard. rolplay-app only (see /api/dashboard/cesar-kpis and
 * lib/bridge-rolplay-app.ts's Cesar KPI functions for the full per-KPI
 * feasibility notes — 9 of 19 KPIs implemented, 10 documented as not
 * computable without fabricating data the platform never recorded).
 *
 * Cards are grouped into the spec's own 5 perspectives and follow its card
 * anatomy (title, description, formula, value, footer interpretation).
 * Only Activation Rate (KPI-1.1) gets a goal bar/status badge -- it's the
 * one KPI in the spec with an actual numeric target ("<80% indica
 * barreras..."). Every other KPI in this set has no spec-sourced goal, so
 * none is shown for it rather than inventing one.
 */

import { useMemo } from "react"
import {
  UserCheck, Repeat, CalendarClock, TrendingUp as TrendUpIcon,
  ShieldCheck, PieChart as MasteryIcon, Compass, Briefcase, ThumbsUp, ThumbsDown,
} from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { CesarKpiCard, CesarKpiValue } from "@/components/CesarKpiCard"
import { DonutChart } from "@/components/charts/DonutChart"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { cn } from "@/lib/utils"

interface AccessCaps { hasRolplayAppAccess?: boolean }

interface CesarKpisResponse {
  activationRate: number | null
  prevActivationRate: number | null
  weeklyPracticeFrequency: number | null
  prevWeeklyPracticeFrequency: number | null
  mauRate: number | null
  prevMauRate: number | null
  deltaScore: number | null
  prevDeltaScore: number | null
  readinessIndex: number | null
  prevReadinessIndex: number | null
  masteryDistribution: { label: string; value: number; pct: number }[]
  adoptionMovementRate: number | null
  prevAdoptionMovementRate: number | null
  commercialDomain: { domain: string; avgScore: number; sessions: number }[]
  topStrengths: { item: string; count: number }[]
  topOpportunities: { item: string; count: number }[]
}

// Sugerencia_de_KPIs_Cesar.xlsx, KPI-1.1: "<80% indica barreras de acceso,
// falta de comunicación o baja prioridad gerencial" -- the one KPI in this
// set with a real, spec-sourced numeric target.
const ACTIVATION_RATE_GOAL = 80

function PerspectiveSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
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

  const hasMasteryData = (data?.masteryDistribution?.length ?? 0) > 0
  const hasCommercialDomainData = (data?.commercialDomain?.length ?? 0) > 0
  const hasStrengthsData = (data?.topStrengths?.length ?? 0) > 0
  const hasOpportunitiesData = (data?.topOpportunities?.length ?? 0) > 0

  const masteryChartData = useMemo(
    () => (data?.masteryDistribution ?? []).map(b => ({ name: b.label, value: b.value })),
    [data],
  )

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

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 max-w-[1400px] mx-auto space-y-8">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-64 rounded-[16px] bg-muted/50 animate-pulse" />)}
          </div>
        ) : (
          <>
            <PerspectiveSection title={t.perspAdoption}>
              <CesarKpiCard
                title={t.kpiActivationRate}
                description={t.kpiActivationRateDesc}
                formula={t.kpiActivationRateFormula}
                footer={t.kpiActivationRateFooter}
                icon={<UserCheck className="w-4 h-4" />}
              >
                <CesarKpiValue
                  value={data?.activationRate ?? null}
                  prevValue={data?.prevActivationRate ?? null}
                  goal={ACTIVATION_RATE_GOAL}
                  goalLabel={t.kpiActivationRateGoalLabel}
                  onTrackLabel={t.kpiOnTrackLabel}
                  belowGoalLabel={t.kpiBelowGoalLabel}
                  deltaLabel={t.kpiVsPreviousPeriod}
                />
              </CesarKpiCard>

              <CesarKpiCard
                title={t.kpiWeeklyPractice}
                description={t.kpiWeeklyPracticeDesc}
                formula={t.kpiWeeklyPracticeFormula}
                footer={t.kpiWeeklyPracticeFooter}
                icon={<Repeat className="w-4 h-4" />}
              >
                <CesarKpiValue
                  value={data?.weeklyPracticeFrequency ?? null}
                  prevValue={data?.prevWeeklyPracticeFrequency ?? null}
                  unit={t.kpiWeeklyPracticeUnit}
                  deltaLabel={t.kpiVsPreviousPeriod}
                />
              </CesarKpiCard>

              <CesarKpiCard
                title={t.kpiMau}
                description={t.kpiMauDesc}
                formula={t.kpiMauFormula}
                footer={t.kpiMauFooter}
                icon={<CalendarClock className="w-4 h-4" />}
              >
                <CesarKpiValue
                  value={data?.mauRate ?? null}
                  prevValue={data?.prevMauRate ?? null}
                  deltaLabel={t.kpiVsPreviousPeriod}
                />
              </CesarKpiCard>
            </PerspectiveSection>

            <PerspectiveSection title={t.perspEfficiency}>
              <CesarKpiCard
                title={t.kpiDeltaScore}
                description={t.kpiDeltaScoreDesc}
                formula={t.kpiDeltaScoreFormula}
                footer={t.kpiDeltaScoreFooter}
                icon={<TrendUpIcon className="w-4 h-4" />}
              >
                <CesarKpiValue
                  value={data?.deltaScore ?? null}
                  prevValue={data?.prevDeltaScore ?? null}
                  unit={t.kpiDeltaScoreUnit}
                  deltaLabel={t.kpiVsPreviousPeriod}
                />
              </CesarKpiCard>
            </PerspectiveSection>

            <PerspectiveSection title={t.perspTechnical}>
              <CesarKpiCard
                title={t.kpiMasteryDistTitle}
                description={t.kpiMasteryDistDesc}
                formula={t.kpiMasteryDistFormula}
                footer={t.kpiMasteryDistFooter}
                icon={<MasteryIcon className="w-4 h-4" />}
                className="sm:col-span-2 lg:col-span-3"
              >
                {!hasMasteryData ? (
                  <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
                ) : (
                  // Basic/Intermediate/Advanced sums to 100% -- a donut, never
                  // separate bars, with the exact count + share kept visible
                  // per level rather than replaced by the chart.
                  <div className="space-y-4">
                    <DonutChart data={masteryChartData} />
                    <div className="space-y-1.5 max-w-md mx-auto">
                      {data!.masteryDistribution.map(b => (
                        <div key={b.label} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{b.label}</span>
                          <span className="font-semibold tabular-nums text-foreground">{b.value} ({b.pct}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CesarKpiCard>
            </PerspectiveSection>

            <PerspectiveSection title={t.perspImpact}>
              <CesarKpiCard
                title={t.kpiAdoptionMovement}
                description={t.kpiAdoptionMovementDesc}
                formula={t.kpiAdoptionMovementFormula}
                footer={t.kpiAdoptionMovementFooter}
                icon={<Compass className="w-4 h-4" />}
              >
                <CesarKpiValue
                  value={data?.adoptionMovementRate ?? null}
                  prevValue={data?.prevAdoptionMovementRate ?? null}
                  deltaLabel={t.kpiVsPreviousPeriod}
                />
              </CesarKpiCard>

              <CesarKpiCard
                title={t.kpiReadinessIndex}
                description={t.kpiReadinessIndexDesc}
                formula={t.kpiReadinessIndexFormula}
                footer={t.kpiReadinessIndexFooter}
                icon={<ShieldCheck className="w-4 h-4" />}
              >
                <CesarKpiValue
                  value={data?.readinessIndex ?? null}
                  prevValue={data?.prevReadinessIndex ?? null}
                  deltaLabel={t.kpiVsPreviousPeriod}
                />
              </CesarKpiCard>
            </PerspectiveSection>

            <PerspectiveSection title={t.perspCommercial}>
              <CesarKpiCard
                title={t.kpiCommercialDomainTitle}
                description={t.kpiCommercialDomainDesc}
                formula={t.kpiCommercialDomainFormula}
                footer={t.kpiCommercialDomainFooter}
                icon={<Briefcase className="w-4 h-4" />}
              >
                {!hasCommercialDomainData ? (
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
              </CesarKpiCard>

              <CesarKpiCard
                title={t.kpiTopStrengthsTitle}
                description={t.kpiTopStrengthsDesc}
                formula={t.kpiTopStrengthsFormula}
                footer={t.kpiTopStrengthsFooter}
                icon={<ThumbsUp className="w-4 h-4" />}
              >
                {!hasStrengthsData ? (
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
              </CesarKpiCard>

              <CesarKpiCard
                title={t.kpiTopOpportunitiesTitle}
                description={t.kpiTopOpportunitiesDesc}
                formula={t.kpiTopOpportunitiesFormula}
                footer={t.kpiTopOpportunitiesFooter}
                icon={<ThumbsDown className="w-4 h-4" />}
              >
                {!hasOpportunitiesData ? (
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
              </CesarKpiCard>
            </PerspectiveSection>
          </>
        )}
      </div>
    </div>
  )
}
