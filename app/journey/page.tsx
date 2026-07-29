"use client"

/**
 * Solution Journey — the tenant's Rolplay services in progression order.
 *
 * Composition note: this page fans out to the EXISTING per-module endpoints
 * (/api/dashboard/overview?solution=…, /api/dashboard/lms,
 * /api/second-brain/profile) rather than a new aggregate route. The overview
 * route is a large per-orgType dispatcher; duplicating that dispatch server-side
 * to save a few requests would mean two copies of the tenant-resolution logic
 * drifting apart. The requests run in parallel and each is already cached.
 *
 * Every stage reports its own metric on its own scale — see lib/journey.ts for
 * why this is deliberately NOT a cross-stage funnel.
 */

import { useMemo } from "react"
import Link from "next/link"
import { ArrowRight, ChevronRight, Info, AlertTriangle } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useAvailableModules } from "@/lib/hooks/useAvailableModules"
import { journeyStages, journeyPhaseGroups, type JourneyStage } from "@/lib/journey"
import { cn } from "@/lib/utils"
import type { LmsApiResponse, OverviewApiResponse, Module } from "@/lib/types"

interface SBProfileResponse {
  stats?: { total_members?: number; active_members?: number; total_coaching_sessions?: number }
}

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

function StageCard({
  stage, index, total, metrics,
}: { stage: JourneyStage; index: number; total: number; metrics: StageMetrics }) {
  const t = useT()

  return (
    <div className="flex-1 min-w-[240px] rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
      <div className="h-[3px] bg-primary" />
      <div className="p-5 flex flex-col gap-4 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t.journeyStageOf.replace("{n}", String(index + 1)).replace("{total}", String(total))}
            </p>
            <h3 className="text-base font-semibold mt-0.5">{t[stage.labelKey]}</h3>
          </div>
          {metrics.progress != null && <ProgressRing value={metrics.progress} />}
        </div>

        {metrics.loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-20 rounded bg-muted" />
            <div className="h-3 w-28 rounded bg-muted" />
          </div>
        ) : metrics.count == null ? (
          <p className="text-sm text-muted-foreground">{t.journeyNoStageData}</p>
        ) : (
          <div>
            <p className="text-[28px] leading-none font-bold tabular-nums">
              {metrics.count.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{metrics.countLabel}</p>
            {metrics.secondary && (
              <p className="text-xs text-muted-foreground mt-2">{metrics.secondary}</p>
            )}
          </div>
        )}

        {/* Name what the ring measures — each stage measures something different. */}
        {metrics.progress != null && (
          <p className="text-[11px] text-muted-foreground mt-auto">{t[stage.progressKey]}</p>
        )}

        <Link
          href={stage.href}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-auto"
        >
          {t.journeyViewDetail}
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
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

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.journeyTitle} subtitle={t.journeySub} />
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {firstError && <ErrorBanner message={`${t.errorLoading}: ${firstError}`} />}

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
                    return (
                      <div key={s.module} className="flex items-center gap-4 flex-1 min-w-[240px]">
                        <StageCard
                          stage={s}
                          index={idx}
                          total={stages.length}
                          metrics={metricsFor(s.module)}
                        />
                        {/* Arrow between consecutive stages, never after the last. */}
                        {idx < stages.length - 1 && (
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
          </div>
        )}

      </div>
    </div>
  )
}
