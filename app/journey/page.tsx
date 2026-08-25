"use client"

/**
 * Solution Journey — the tenant's Rolplay services in progression order,
 * bookended by an Initial Diagnostic and a Final Exam so the page tells the
 * platform's actual value story: where the learner started, what they
 * completed, how they improved, and where they stand now.
 *
 * Composition note: this page fans out to the EXISTING per-module endpoints
 * (/api/dashboard/overview?solution=…, /api/dashboard/lms,
 * /api/second-brain/profile) rather than a new aggregate route, plus the new
 * /api/dashboard/journey-bookends for the two demo-only bookend stages. The
 * overview route is a large per-orgType dispatcher; duplicating that dispatch
 * server-side to save a few requests would mean two copies of the
 * tenant-resolution logic drifting apart. The requests run in parallel and
 * each is already cached.
 *
 * Every REAL stage (LMS/Coach/Simulator/Certification/Second Brain) reports
 * its own metric on its own scale — see lib/journey.ts for why this is
 * deliberately NOT a cross-stage funnel. The two BOOKEND stages (Diagnostic,
 * Final Exam) are demo-only mock data (lib/demo/journey-bookends.ts) — real
 * mode gets null for both and simply omits them, never a fabricated score.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, ChevronRight, ChevronDown, Info, AlertTriangle, Target, TrendingUp } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useAvailableModules } from "@/lib/hooks/useAvailableModules"
import { journeyStages, journeyPhaseGroups, type JourneyStage } from "@/lib/journey"
import type { JourneyBookend } from "@/lib/demo/journey-bookends"
import type { JourneyBookendsApiResponse } from "@/app/api/dashboard/journey-bookends/route"
import { cn } from "@/lib/utils"
import type { LmsApiResponse, OverviewApiResponse, Module } from "@/lib/types"

interface SBProfileResponse {
  stats?: { total_members?: number; active_members?: number; total_coaching_sessions?: number }
}

type StageStatus = "completed" | "in_progress" | "upcoming"

/** One stage's numbers, normalised to what the card renders. */
interface StageMetrics {
  loading: boolean
  /** Headline count and what it counts. */
  countLabel: string
  count: number | null
  /** 0-100 for the bar, or null when the stage has no meaningful rate. */
  progress: number | null
  secondary: string | null
}

/** A REAL stage's status is derived from whether it has any real activity in
 *  the selected range — there is no genuine "in progress" state for a whole
 *  module (a tenant either has recorded sessions or doesn't), so this is
 *  deliberately binary rather than inventing a third state the data can't
 *  support. */
function statusForRealStage(metrics: StageMetrics): StageStatus {
  if (metrics.loading) return "upcoming"
  return metrics.count != null && metrics.count > 0 ? "completed" : "upcoming"
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function ProgressRing({ value }: { value: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  const filled = Math.max(0, Math.min(100, value))
  const color =
    filled >= 70 ? "text-primary"
    : filled >= 40 ? "text-amber-500"
    : "text-destructive"
  return (
    <div className="relative w-[64px] h-[64px] shrink-0">
      <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle
          cx="32" cy="32" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          className={cn("stroke-current transition-all", color)}
          strokeDasharray={c}
          strokeDashoffset={c - (filled / 100) * c}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">
        {Math.round(filled)}%
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: StageStatus }) {
  const t = useT()
  const label = status === "completed" ? t.journeyStatusCompleted
    : status === "in_progress" ? t.journeyStatusInProgress
    : t.journeyStatusUpcoming
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide",
      status === "completed" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      status === "in_progress" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      status === "upcoming" && "bg-muted text-muted-foreground",
    )}>
      {label}
    </span>
  )
}

/**
 * Card shared by every stage (real or bookend) so the whole row reads as one
 * visual language. Clicking anywhere on the card (other than the "view full
 * page" link) toggles an inline detail panel — never a fake interaction: the
 * panel always shows the same real fields (status, score/count, sessions,
 * first-session date) the card summarizes.
 */
function StageCard({
  labelKey, index, total, status, metrics, bookend, href, isBookend,
}: {
  labelKey: string
  index: number
  total: number
  status: StageStatus
  metrics?: StageMetrics
  bookend?: JourneyBookend
  href?: string
  isBookend?: boolean
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)

  const progress = bookend ? (bookend.score / bookend.maxScore) * 100 : metrics?.progress ?? null
  const count = bookend ? bookend.score : metrics?.count ?? null
  const countLabel = bookend ? `${t.journeyScoreOutOf} ${bookend.maxScore}` : metrics?.countLabel ?? ""
  const loading = !!metrics?.loading
  const sessions = bookend ? bookend.sessions : metrics?.count ?? null
  const firstSessionDate = bookend?.firstSessionDate ?? null

  return (
    <div className={cn(
      "flex-1 min-w-[240px] rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col transition-shadow",
      isBookend ? "border-accent/40" : "border-border",
    )}>
      <div className={cn("h-[3px]", isBookend ? "bg-accent" : "bg-primary")} />
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="p-5 flex flex-col gap-4 flex-1 text-left w-full"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.journeyStageOf.replace("{n}", String(index + 1)).replace("{total}", String(total))}
            </p>
            <h3 className="text-base font-semibold mt-0.5">{labelKey}</h3>
            <div className="mt-1.5"><StatusBadge status={status} /></div>
          </div>
          {progress != null && <ProgressRing value={progress} />}
        </div>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-20 rounded bg-muted" />
            <div className="h-3 w-28 rounded bg-muted" />
          </div>
        ) : count == null ? (
          <p className="text-sm text-muted-foreground">{t.journeyNoStageData}</p>
        ) : (
          <div>
            <p className="text-[28px] leading-none font-bold tabular-nums">
              {count.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{countLabel}</p>
            {metrics?.secondary && !bookend && (
              <p className="text-xs text-muted-foreground mt-2">{metrics.secondary}</p>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-180")} />
          {expanded ? t.journeyHideDetail : t.journeyShowDetail}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 -mt-1 space-y-1.5 text-xs text-muted-foreground border-t border-border/60 pt-3">
          <div className="flex justify-between"><span>{t.journeyDetailStatus}</span><span className="font-medium text-foreground"><StatusBadge status={status} /></span></div>
          {sessions != null && (
            <div className="flex justify-between"><span>{t.journeySessions}</span><span className="font-medium text-foreground">{sessions.toLocaleString()}</span></div>
          )}
          {bookend && (
            <div className="flex justify-between"><span>{t.journeyDetailScore}</span><span className="font-medium text-foreground">{bookend.score} / {bookend.maxScore}</span></div>
          )}
          {firstSessionDate && (
            <div className="flex justify-between"><span>{t.journeyFirstSession}</span><span className="font-medium text-foreground">{firstSessionDate}</span></div>
          )}
          {href && (
            <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline pt-1">
              {t.journeyViewDetail}
              <ChevronRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

/** Prominent progress counter, computed from the actual rendered stages'
 *  statuses — never a hardcoded/fake percentage. */
function ProgressCounter({ completed, total }: { completed: number; total: number }) {
  const t = useT()
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-5 flex items-center gap-5">
      <ProgressRing value={pct} />
      <div>
        <p className="text-sm font-semibold text-foreground">{t.journeyProgressTitle}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t.journeyProgressOfPre}{completed}{t.journeyProgressOfMid}{total}{t.journeyProgressOfPost}
        </p>
      </div>
    </div>
  )
}

/** Before → after value story. Only rendered when BOTH bookends are present
 *  (real mode without a diagnostic/final-exam source simply omits this card
 *  entirely, rather than showing half a comparison). */
function ValueStoryCard({ diagnostic, finalExam, currentAvg }: {
  diagnostic: JourneyBookend
  finalExam: JourneyBookend
  currentAvg: number | null
}) {
  const t = useT()
  const improvement = Math.round((finalExam.score - diagnostic.score) * 10) / 10
  const improvementPct = diagnostic.score > 0
    ? Math.round((improvement / diagnostic.score) * 1000) / 10
    : null

  return (
    <div className="rounded-xl border border-accent/40 bg-card shadow-sm p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-semibold">{t.journeyValueStoryTitle}</h3>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        <div className="text-center flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t.journeyDiagnosticLabel}</p>
          <p className="text-3xl font-bold tabular-nums mt-1">{diagnostic.score}<span className="text-sm text-muted-foreground font-normal"> / {diagnostic.maxScore}</span></p>
        </div>
        <ArrowRight className="w-5 h-5 text-muted-foreground/40 shrink-0 rotate-90 sm:rotate-0" />
        {currentAvg != null && (
          <>
            <div className="text-center flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t.journeyCurrentAvgLabel}</p>
              <p className="text-2xl font-semibold tabular-nums mt-1 text-muted-foreground">{currentAvg}<span className="text-sm font-normal"> / 10</span></p>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground/40 shrink-0 rotate-90 sm:rotate-0" />
          </>
        )}
        <div className="text-center flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t.journeyFinalExamLabel}</p>
          <p className="text-3xl font-bold tabular-nums mt-1 text-primary">{finalExam.score}<span className="text-sm text-muted-foreground font-normal"> / {finalExam.maxScore}</span></p>
        </div>
      </div>
      <div className="mt-5 pt-4 border-t border-border/60 text-center">
        <span className={cn(
          "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold",
          improvement >= 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        )}>
          <TrendingUp className="w-3.5 h-3.5" />
          {improvement >= 0 ? "+" : ""}{improvement} {t.journeyPointsImprovement}
          {improvementPct != null && ` (${improvementPct >= 0 ? "+" : ""}${improvementPct}%)`}
        </span>
      </div>
    </div>
  )
}

function Timeline({ from }: { from: string }) {
  const t = useT()
  const today = new Date().toLocaleDateString()
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Target className="w-3.5 h-3.5 shrink-0" />
      <span>{t.journeyTimelinePre}{from}{t.journeyTimelinePost}{today}</span>
    </div>
  )
}

export default function JourneyPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t = useT()
  const { modules, loading: modulesLoading } = useAvailableModules()

  const stages = useMemo(() => journeyStages(modules), [modules])
  const has = (m: Module) => stages.some(s => s.module === m)

  // Only fetch what the tenant actually has — useApi treats a null url as a no-op.
  const range = (extra: Record<string, string | number>) =>
    buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { rk: refreshKey, ...extra })

  const lms = useApi<LmsApiResponse>(
    has('lms') ? buildApiUrl("/api/dashboard/lms", dateRange.from, dateRange.to, { rk: refreshKey }) : null
  )
  const coach = useApi<OverviewApiResponse>(has('coach') ? range({ solution: 'coach' }) : null)
  const sim = useApi<OverviewApiResponse>(has('simulator') ? range({ solution: 'simulator' }) : null)
  const cert = useApi<OverviewApiResponse>(has('certification') ? range({ solution: 'certification' }) : null)
  const sb = useApi<SBProfileResponse>(has('second-brain') ? "/api/second-brain/profile" : null)
  const bookends = useApi<JourneyBookendsApiResponse>(buildApiUrl("/api/dashboard/journey-bookends", dateRange.from, dateRange.to, { rk: refreshKey }))

  /** Map each module onto the card's normalised shape. */
  const metricsFor = (module: Module): StageMetrics => {
    switch (module) {
      case 'lms': {
        const d = lms.data
        return {
          loading: lms.loading,
          count: d?.configured ? d.enrolledUsers : null,
          countLabel: t.enrolledUsers,
          progress: d?.completionRate ?? null,
          secondary: d ? `${d.modulesCompleted.toLocaleString()} ${t.journeyCompleted}` : null,
        }
      }
      case 'second-brain': {
        const s = sb.data?.stats
        const total = s?.total_members ?? 0
        const active = s?.active_members ?? 0
        return {
          loading: sb.loading,
          count: s ? active : null,
          countLabel: t.journeyActiveMembers,
          // Adoption, not a pass rate — labelled as such on the card.
          progress: total > 0 ? Math.round((active / total) * 1000) / 10 : null,
          secondary: s?.total_coaching_sessions != null
            ? `${s.total_coaching_sessions.toLocaleString()} ${t.journeySessions}`
            : null,
        }
      }
      default: {
        // coach / simulator / certification all come from the overview shape.
        const src = module === 'coach' ? coach : module === 'simulator' ? sim : cert
        const d = src.data
        return {
          loading: src.loading,
          count: d ? d.totalEvaluations : null,
          countLabel: t.journeySessions,
          progress: d?.passRate ?? null,
          secondary: d?.avgScore != null ? `${d.avgScore} ${t.avgScore}` : null,
        }
      }
    }
  }

  const groups = useMemo(() => journeyPhaseGroups(stages), [stages])
  const firstError = lms.error || coach.error || sim.error || cert.error || sb.error

  const diagnostic = bookends.data?.diagnostic ?? null
  const finalExam = bookends.data?.finalExam ?? null

  // Progress counter: completed / total across EVERY rendered stage
  // (bookends + real modules) — never a hardcoded percentage.
  const realStatuses = stages.map(s => statusForRealStage(metricsFor(s.module)))
  const allStatuses: StageStatus[] = [
    ...(diagnostic ? [diagnostic.status] : []),
    ...realStatuses,
    ...(finalExam ? [finalExam.status] : []),
  ]
  const completedCount = allStatuses.filter(s => s === "completed").length
  const totalStages = allStatuses.length

  // "Current average" ties the real modules' own scores into the before/
  // after story WITHOUT mixing data sources — a pure frontend composition
  // of already-fetched real avgScore/avgQuizScore values, weighted by each
  // module's own session count, never written back into any real KPI.
  const currentAvg = useMemo(() => {
    const points: { score: number; weight: number }[] = []
    if (coach.data?.avgScore != null) points.push({ score: coach.data.avgScore / 10, weight: coach.data.totalEvaluations || 1 })
    if (sim.data?.avgScore != null) points.push({ score: sim.data.avgScore / 10, weight: sim.data.totalEvaluations || 1 })
    if (cert.data?.avgScore != null) points.push({ score: cert.data.avgScore / 10, weight: cert.data.totalEvaluations || 1 })
    if (lms.data?.avgQuizScore != null) points.push({ score: lms.data.avgQuizScore / 10, weight: lms.data.totalEnrollments || 1 })
    if (!points.length) return null
    const totalWeight = points.reduce((s, p) => s + p.weight, 0)
    return Math.round((points.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight) * 10) / 10
  }, [coach.data, sim.data, cert.data, lms.data])

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.journeyTitle} subtitle={t.journeySub} />
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {firstError && <ErrorBanner message={`${t.errorLoading}: ${firstError}`} />}

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <ProgressCounter completed={completedCount} total={totalStages} />
          {diagnostic && <Timeline from={diagnostic.firstSessionDate} />}
        </div>

        {/* Say plainly that stages are independent, so nobody reads the row as a funnel. */}
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t.journeyIndependentNote}</span>
        </div>

        {modulesLoading ? (
          <div className="flex gap-4 flex-wrap">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex-1 min-w-[240px] rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="h-[3px] bg-primary" />
                <div className="p-5 space-y-3 animate-pulse">
                  <div className="h-3 w-20 rounded bg-muted" />
                  <div className="h-5 w-32 rounded bg-muted" />
                  <div className="h-8 w-24 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {diagnostic && (
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">{t.journeyPhaseDiagnostic}</h2>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="flex gap-4 flex-wrap items-stretch">
                  <div className="flex items-center gap-4 flex-1 min-w-[240px]">
                    <StageCard
                      labelKey={t.journeyDiagnosticLabel}
                      index={0}
                      total={totalStages}
                      status={diagnostic.status}
                      bookend={diagnostic}
                      isBookend
                    />
                    <ArrowRight className="w-5 h-5 shrink-0 text-muted-foreground/40 hidden xl:block" aria-hidden="true" />
                  </div>
                </div>
              </section>
            )}

            {groups.map((g, gi) => (
              <section key={`${g.phase}-${gi}`} className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
                    {t[g.phaseKey]}
                  </h2>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="flex gap-4 flex-wrap items-stretch">
                  {g.stages.map(s => {
                    const idx = stages.findIndex(x => x.module === s.module)
                    const offset = diagnostic ? 1 : 0
                    const metrics = metricsFor(s.module)
                    return (
                      <div key={s.module} className="flex items-center gap-4 flex-1 min-w-[240px]">
                        <StageCard
                          labelKey={t[s.labelKey]}
                          index={idx + offset}
                          total={totalStages}
                          status={statusForRealStage(metrics)}
                          metrics={metrics}
                          href={s.href}
                        />
                        {/* Arrow between consecutive stages, never after the last real stage unless a final exam follows. */}
                        {(idx < stages.length - 1 || finalExam) && (
                          <ArrowRight
                            className="w-5 h-5 shrink-0 text-muted-foreground/40 hidden xl:block"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}

            {finalExam && (
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-accent">{t.journeyPhaseFinal}</h2>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="flex gap-4 flex-wrap items-stretch">
                  <StageCard
                    labelKey={t.journeyFinalExamLabel}
                    index={totalStages - 1}
                    total={totalStages}
                    status={finalExam.status}
                    bookend={finalExam}
                    isBookend
                  />
                </div>
              </section>
            )}

            {diagnostic && finalExam && (
              <ValueStoryCard diagnostic={diagnostic} finalExam={finalExam} currentAvg={currentAvg} />
            )}
          </div>
        )}

      </div>
    </div>
  )
}
