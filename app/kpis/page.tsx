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
  AlertTriangle, UserCheck, Repeat, CalendarClock, TrendingUp as TrendUpIcon,
  ShieldCheck, PieChart as MasteryIcon, Compass, Briefcase, ThumbsUp, ThumbsDown,
  ListChecks, Target, Award, LineChart as LineChartIcon, Layers, Trophy,
} from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { CesarKpiCard, CesarKpiValue } from "@/components/CesarKpiCard"
import { DonutChart } from "@/components/charts/DonutChart"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { cn } from "@/lib/utils"
import type { OverviewApiResponse, TrendsApiResponse, UsecaseBreakdownApiResponse, BestPerformersApiResponse } from "@/lib/types"

interface AccessCaps { hasRolplayAppAccess?: boolean; hasPharmaAccess?: boolean }

interface CesarKpisResponse {
  activationRate: number | null
  prevActivationRate: number | null
  weeklyPracticeFrequency: number | null
  prevWeeklyPracticeFrequency: number | null
  mauRate: number | null
  prevMauRate: number | null
  deltaScore: number | null
  prevDeltaScore: number | null
  // True when deltaScore was computed from a truncated per-user scan (the
  // bridge's own sampling cap was actually hit) rather than from every scored
  // session in range -- see lib/bridge-rolplay-app.ts's CesarGroup1Kpis. This
  // used to be dropped silently right here: the bridge computed and returned
  // it, the API route forwarded it, but this interface never declared or read
  // it, so a truncated (sampled) average was shown identically to a complete
  // one with no indication to the viewer.
  deltaScoreSampled?: boolean
  readinessIndex: number | null
  prevReadinessIndex: number | null
  masteryDistribution: { label: string; value: number; pct: number }[]
  adoptionMovementRate: number | null
  prevAdoptionMovementRate: number | null
  commercialDomain: { domain: string; avgScore: number; sessions: number }[]
  topStrengths: { item: string; count: number }[]
  topOpportunities: { item: string; count: number }[]
  // True when Commercial Domain / Top Strengths / Top Opportunities /
  // Adoption Movement Rate were all computed from a truncated most-recent-N
  // scan (the bridge's closing-data sampling cap was hit), same class of
  // truncation as deltaScoreSampled above but for these four KPIs instead.
  closingDataSampled?: boolean
}

// Sugerencia_de_KPIs_Cesar.xlsx, KPI-1.1: "<80% indica barreras de acceso,
// falta de comunicación o baja prioridad gerencial" -- the one KPI in this
// set with a real, spec-sourced numeric target.
const ACTIVATION_RATE_GOAL = 80

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function PerspectiveSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
  )
}

/**
 * Pharma tenants (Apotex, Sanfer, ...) have no rolplay_app_sql access, so the
 * Cesar KPI suite below (which needs r_user_session's raw_closing_data JSON)
 * has nothing to compute from -- forcing it here would mean fabricating
 * numbers the pharma schema doesn't have. This shows pharma's OWN real,
 * already-computed metrics instead (the exact same Overview/Trends/Usecase/
 * Best-performers data their other pages already show), in the same
 * "what is this, what's the formula, why does it matter" card format --
 * closing the "we don't know how the KPIs are composed" gap from the same
 * real source data, not a different or invented one.
 */
function PharmaKpisView() {
  const { dateRange, selectedSolution, refreshKey } = useDashboardStore()
  const t = useT()

  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
  const ucUrl = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
  const bestUrl = buildApiUrl("/api/dashboard/best-performers", dateRange.from, dateRange.to, { limit: 10, solution: selectedSolution, rk: refreshKey })

  const { data: overview, loading: l1, error: e1 } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends, loading: l2 } = useApi<TrendsApiResponse>(trendsUrl)
  const { data: uc, loading: l3 } = useApi<UsecaseBreakdownApiResponse>(ucUrl)
  const { data: best, loading: l4 } = useApi<BestPerformersApiResponse>(bestUrl)

  const loading = l1 || l2 || l3 || l4
  const hasPassRate = overview?.passRateLegend !== null // undefined = not wired up yet (render normally); null = explicitly no criteria (hide)
  const scoreTrendData = useMemo(() => (trends?.scoreTrend ?? []).map(p => ({ date: p.date, value: p.value })), [trends])
  const ucRows = uc?.data ?? []
  const bestRows = best?.data ?? []

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 rounded-[16px] bg-muted/50 animate-pulse" />)}
      </div>
    )
  }

  return (
    <>
      {e1 && <ErrorBanner message={`${t.errorLoading}: ${e1}`} />}
      <PerspectiveSection title={t.perspAdoption}>
        <CesarKpiCard
          title={t.kpiTotalEvalTitle} description={t.kpiTotalEvalDesc} formula={t.kpiTotalEvalFormula}
          footer={t.kpiTotalEvalFooter} icon={<ListChecks className="w-4 h-4" />}
        >
          <CesarKpiValue value={overview?.totalEvaluations ?? null} unit="" prevValue={overview?.prevTotalEvaluations ?? null} deltaLabel={t.kpiVsPreviousPeriod} />
        </CesarKpiCard>

        <CesarKpiCard
          title={t.kpiAvgScoreTitle} description={t.kpiAvgScoreDesc} formula={t.kpiAvgScoreFormula}
          footer={t.kpiAvgScoreFooter} icon={<Target className="w-4 h-4" />}
        >
          <CesarKpiValue value={overview?.avgScore ?? null} unit={t.unitPts} prevValue={overview?.prevAvgScore ?? null} deltaLabel={t.kpiVsPreviousPeriod} />
        </CesarKpiCard>

        {hasPassRate && (
          <CesarKpiCard
            title={t.kpiPassRateTitle} description={t.kpiPassRateDesc} formula={t.kpiPassRateFormula}
            footer={overview?.passRateLegend || t.kpiPassRateFooter} icon={<Award className="w-4 h-4" />}
          >
            <CesarKpiValue value={overview?.passRate ?? null} prevValue={overview?.prevPassRate ?? null} deltaLabel={t.kpiVsPreviousPeriod} />
          </CesarKpiCard>
        )}
      </PerspectiveSection>

      <PerspectiveSection title={t.perspTechnical}>
        <CesarKpiCard
          title={t.kpiScoreTrendTitle} description={t.kpiScoreTrendDesc} formula={t.kpiScoreTrendFormula}
          footer={t.kpiScoreTrendFooter} icon={<LineChartIcon className="w-4 h-4" />}
          className="sm:col-span-2 lg:col-span-3"
        >
          {scoreTrendData.length === 0
            ? <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
            : <ActivityLineChart data={scoreTrendData} label={t.kpiAvgScoreTitle} />}
        </CesarKpiCard>
      </PerspectiveSection>

      <PerspectiveSection title={t.perspCommercial}>
        <CesarKpiCard
          title={t.kpiUsecaseBreakdownTitle} description={t.kpiUsecaseBreakdownDesc} formula={t.kpiUsecaseBreakdownFormula}
          footer={t.kpiUsecaseBreakdownFooter} icon={<Layers className="w-4 h-4" />}
          className="sm:col-span-2 lg:col-span-3"
        >
          {ucRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
          ) : (
            <div className="space-y-2">
              {ucRows.slice(0, 8).map(r => (
                <div key={r.usecaseId} className="flex items-center justify-between text-sm gap-3">
                  <span className="text-foreground truncate">{r.usecase_name ?? `#${r.usecaseId}`}</span>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {r.totalEvaluations} · {r.avgScore != null ? `${r.avgScore} ${t.unitPts}` : "—"} · {r.passRate != null ? `${r.passRate}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CesarKpiCard>

        <CesarKpiCard
          title={t.kpiBestPerformersTitle} description={t.kpiBestPerformersDesc} formula={t.kpiBestPerformersFormula}
          footer={t.kpiBestPerformersFooter} icon={<Trophy className="w-4 h-4" />}
          className="sm:col-span-2 lg:col-span-3"
        >
          {bestRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
          ) : (
            <div className="space-y-2">
              {bestRows.slice(0, 8).map(r => (
                <div key={r.user_email} className="flex items-center justify-between text-sm gap-3">
                  <span className="text-foreground truncate">{r.user_name || r.user_email}</span>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {r.sessions} · {r.avg_score} {t.unitPts} · {r.pass_rate}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </CesarKpiCard>
      </PerspectiveSection>
    </>
  )
}

export default function KpisPage() {
  const { dateRange, selectedSolution, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = !!access?.hasRolplayAppAccess
  const pharmaReady = !ready && !!access?.hasPharmaAccess

  const url = ready
    ? buildApiUrl("/api/dashboard/cesar-kpis", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
    : null
  const { data, loading, error } = useApi<CesarKpisResponse>(url)

  const hasMasteryData = (data?.masteryDistribution?.length ?? 0) > 0
  const hasCommercialDomainData = (data?.commercialDomain?.length ?? 0) > 0
  const hasStrengthsData = (data?.topStrengths?.length ?? 0) > 0
  const hasOpportunitiesData = (data?.topOpportunities?.length ?? 0) > 0

  const masteryChartData = useMemo(
    () => (data?.masteryDistribution ?? []).map(b => ({ name: b.label, value: b.value })),
    [data],
  )

  if (pharmaReady) {
    return (
      <div className="min-h-screen w-full">
        <DashboardHeader title={t.navKpis} subtitle={t.pharmaKpisSubtitle} showModuleFilter />
        <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 max-w-[1400px] mx-auto space-y-8">
          <PharmaKpisView />
        </div>
      </div>
    )
  }

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
        {/* Was silently dropped: a backend/tenant-resolution failure rendered
            identically to a real "no KPI data" tenant. Surfacing it
            distinguishes "something broke" from "genuinely empty". */}
        {error && <ErrorBanner message={`${t.errorLoading}: ${error}`} />}
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
                footer={data?.deltaScoreSampled ? `${t.kpiDeltaScoreFooter} ${t.kpiDeltaScoreSampledNote}` : t.kpiDeltaScoreFooter}
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
                footer={data?.closingDataSampled ? `${t.kpiCommercialDomainFooter} ${t.kpiDeltaScoreSampledNote}` : t.kpiCommercialDomainFooter}
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
                footer={data?.closingDataSampled ? `${t.kpiTopStrengthsFooter} ${t.kpiDeltaScoreSampledNote}` : t.kpiTopStrengthsFooter}
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
                footer={data?.closingDataSampled ? `${t.kpiTopOpportunitiesFooter} ${t.kpiDeltaScoreSampledNote}` : t.kpiTopOpportunitiesFooter}
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
