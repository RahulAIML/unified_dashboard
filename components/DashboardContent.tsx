"use client"

import { useMemo, useEffect, useReducer, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Target, PlayCircle, TrendingUp, BadgeCheck, BarChart2, AlertTriangle, Trophy, MessageSquare, Users, Search, FileText } from "lucide-react"
import { DashboardHeader }    from "@/components/DashboardHeader"
import { SummaryCard }        from "@/components/SummaryCard"
import { MetricCard } from "@/components/MetricCard"
import { ChartCard }          from "@/components/ChartCard"
import { ActivityLineChart }  from "@/components/charts/ActivityLineChart"
import { ModuleBarChart }     from "@/components/charts/ModuleBarChart"
import { DonutChart }         from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { useDashboardStore }  from "@/lib/store"
import { useT }               from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useCombinedExport } from "@/lib/hooks/useCombinedExport"
import { calcDeltaPct, estimatePassedSessions } from "@/lib/kpi-builder"
import { cn }                 from "@/lib/utils"
import { csvFilename } from "@/lib/csv-export"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import Link from "next/link"
import { useAuthContext } from "@/components/AuthProvider"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  ResultsApiResponse,
  EvaluationApiRow,
  BestPerformersApiResponse,
  BestPerformerRow,
} from "@/lib/types"
import type { Module } from "@/lib/types"

// ── Access status (returned by /api/auth/access-status) ───────────────────────
interface AccessStatus {
  hasCoachData:       boolean
  hasSecondBrainData: boolean
  hasBancoAccess:     boolean
  hasPharmaAccess:    boolean
  hasAnyAccess:       boolean
}

// ── Second Brain profile (returned by /api/second-brain/profile) ──────────────
type SecondBrainProfile = {
  stats?: {
    total_members?: number
    active_members?: number
    total_message_logs?: number
    total_documents?: number
    knowledgebase_docs?: number
    datastore_docs?: number
  }
  message_logs?: {
    total?: number
    recent_30_days?: number
    rag_queries?: number
  }
  members?: Array<{ is_active?: boolean }>
}

// ── KPI icons ─────────────────────────────────────────────────────────────────
const kpiIcons = [
  <PlayCircle key="p"  className="w-4 h-4" />,
  <Target     key="t"  className="w-4 h-4" />,
  <TrendingUp key="tr" className="w-4 h-4" />,
  <BadgeCheck key="b"  className="w-4 h-4" />,
]

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div className="rounded-[16px] border border-border/60 bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] animate-pulse">
      <div className="h-[3px] bg-gradient-to-r from-primary to-accent" />
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-3 w-24 rounded bg-muted skeleton-shimmer" />
          <div className="w-9 h-9 rounded-xl bg-muted skeleton-shimmer" />
        </div>
        <div className="h-9 w-28 rounded bg-muted skeleton-shimmer" />
        <div className="flex items-center gap-2">
          <div className="h-6 w-16 rounded-lg bg-muted skeleton-shimmer" />
          <div className="h-3 w-12 rounded bg-muted/50 skeleton-shimmer" />
        </div>
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-[300px] sm:h-[320px] bg-gradient-to-r from-muted via-muted/80 to-muted rounded-xl skeleton-shimmer" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-6 w-20 rounded-lg bg-muted skeleton-shimmer" />
        ))}
      </div>
    </div>
  )
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex gap-3 pb-3 border-b border-border/50">
        <div className="h-4 w-20 rounded bg-muted skeleton-shimmer" />
        <div className="h-4 w-24 rounded bg-muted skeleton-shimmer" />
        <div className="h-4 w-20 rounded bg-muted skeleton-shimmer" />
        <div className="h-4 w-16 rounded bg-muted skeleton-shimmer" />
        <div className="h-4 w-24 rounded bg-muted skeleton-shimmer" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 py-3">
          <div className="h-4 w-20 rounded bg-muted/70 skeleton-shimmer" />
          <div className="h-4 w-24 rounded bg-muted/70 skeleton-shimmer" />
          <div className="h-4 w-20 rounded bg-muted/70 skeleton-shimmer" />
          <div className="h-4 w-16 rounded bg-muted/70 skeleton-shimmer" />
          <div className="h-4 w-24 rounded bg-muted/70 skeleton-shimmer" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ message }: { message?: string }) {
  const t = useT()
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>{message ?? t.noDataAvailable}</span>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function DashboardContent() {
  const { dateRange, selectedSolution, refreshKey } = useDashboardStore()
  const t           = useT()
  const brand       = useClientBrand()
  const { user }    = useAuthContext()
  const { exportAllSolutions, loading: exportLoading } = useCombinedExport()

  const isSecondBrain = selectedSolution === "second-brain"

  // ── Access status — server-side probe via API (env vars unavailable client-side)
  // useApi returns null url when user is not loaded → no fetch, no crash.
  const { data: accessStatus, loading: accessLoading } = useApi<AccessStatus>(
    user ? "/api/auth/access-status" : null
  )

  // ── Shimmer on solution switch ─────────────────────────────────────────────
  const [shimmer, dispatchShimmer] = useReducer((_: boolean, next: boolean) => next, false)
  const prevSolution = useRef<Module | null>(null)

  useEffect(() => {
    if (prevSolution.current === selectedSolution) return
    prevSolution.current = selectedSolution
    dispatchShimmer(true)
    const tid = setTimeout(() => dispatchShimmer(false), 400)
    return () => clearTimeout(tid)
  }, [selectedSolution])

  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  // ── API URLs — null until access confirmed, null for wrong module ──────────
  // This prevents unnecessary DB queries and avoids firing requests before we
  // know whether the user has DB access.
  // Banco/pharma users have hasCoachData=false (not in coach_users) but still
  // get analytics data from their own pipeline — include both flags here.
  const dbReady = (
    accessStatus?.hasCoachData === true ||
    accessStatus?.hasBancoAccess === true ||
    accessStatus?.hasPharmaAccess === true
  ) && !isSecondBrain

  const overviewUrl = dbReady
    ? buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
    : null

  const trendsUrl = dbReady
    ? buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
    : null

  const ucUrl = dbReady
    ? buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: selectedSolution, rk: refreshKey })
    : null

  const resultsUrl = dbReady
    ? buildApiUrl("/api/dashboard/results", dateRange.from, dateRange.to, { limit: 20, solution: selectedSolution, rk: refreshKey })
    : null

  const bestUrl = dbReady
    ? buildApiUrl("/api/dashboard/best-performers", dateRange.from, dateRange.to, { limit: 10, solution: selectedSolution, rk: refreshKey })
    : null

  // The "Certified Users" KPI card must show real certification data (Sanfer's
  // cert.stats.certified, a separate authoritative source), never the default
  // view's passedEvaluations (session pass/fail count) — those are genuinely
  // different numbers and showing the session count under a "Certified" label
  // is factually wrong, not just a duplicate-looking tile. Only needed on the
  // unfiltered "All" view — a solution-filtered overview (e.g. Certifier Coach)
  // already IS the certification-specific data.
  const overviewCertUrl = (dbReady && !selectedSolution)
    ? buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: "certification", rk: refreshKey })
    : null

  // ALL useApi calls are unconditional — urls may be null (hook ignores them safely)
  const { data: overview,       loading: overviewLoading, error: overviewError }  = useApi<OverviewApiResponse>(overviewUrl)
  const { data: overviewCert }                                                    = useApi<OverviewApiResponse>(overviewCertUrl)
  const { data: trends,         loading: trendsLoading,   error: trendsError }    = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown,    loading: ucLoading,       error: ucError }        = useApi<UsecaseBreakdownApiResponse>(ucUrl)
  const { data: results,        loading: resultsLoading,  error: resultsError }   = useApi<ResultsApiResponse>(resultsUrl)
  const { data: bestPerformers, loading: bestLoading }                            = useApi<BestPerformersApiResponse>(bestUrl)

  // Second Brain profile — only fetch when user has SB access and that module is active
  const sbReady = isSecondBrain && accessStatus?.hasSecondBrainData === true
  const { data: sbProfile, loading: sbLoading, error: sbError } = useApi<SecondBrainProfile>(
    sbReady ? "/api/second-brain/profile" : null
  )

  const hasOverviewData = overview && overview.totalEvaluations > 0

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpiCards = useMemo(() => {
    if (isSecondBrain) return []
    if (!hasOverviewData) return []
    const d = calcDeltaPct
    return [
      {
        label: "Practice Sessions", labelKey: "practiceSessions" as const,
        value: overview!.totalEvaluations,
        delta: d(overview!.totalEvaluations, overview!.prevTotalEvaluations),
        tier: "A" as const,
      },
      {
        label: "Avg Session Score", labelKey: "avgSessionScore" as const,
        value: overview!.avgScore ?? 0, unit: "pts",
        delta: d(overview!.avgScore ?? 0, overview!.prevAvgScore ?? 0),
        tier: "B" as const,
      },
      {
        label: "Overall Pass Rate", labelKey: "overallPassRate" as const,
        value: overview!.passRate ?? 0, unit: "%",
        delta: d(overview!.passRate ?? 0, overview!.prevPassRate ?? 0),
        tier: "B" as const,
      },
      {
        label: "Certified Users", labelKey: "certifiedUsers" as const,
        // cert.stats is a current-state snapshot with no date range, so there
        // is no real "previous period" to diff against — show "no comparison"
        // rather than a fabricated-looking 0% trend.
        value: (overviewCert && overviewCert.totalEvaluations > 0)
          ? overviewCert.passedEvaluations
          : overview!.passedEvaluations,
        delta: (overviewCert && overviewCert.totalEvaluations > 0)
          ? 0
          : d(
              overview!.passedEvaluations,
              estimatePassedSessions(overview!.prevTotalEvaluations, overview!.prevPassRate)
            ),
        noComparison: overviewCert != null && overviewCert.totalEvaluations > 0,
        tier: "A" as const,
      },
    ]
  }, [overview, overviewCert, hasOverviewData, isSecondBrain])

  const secondBrainKpis = useMemo(() => {
    if (!isSecondBrain || !sbProfile) return []

    const stats      = sbProfile.stats ?? {}
    const messageLogs = sbProfile.message_logs ?? {}
    const members    = Array.isArray(sbProfile.members) ? sbProfile.members : []

    const totalMembers   = Number(stats.total_members   ?? members.length ?? 0)
    const activeMembers  = Number(
      stats.active_members ?? members.filter((m) => m?.is_active).length ?? 0
    )
    const totalConversations = Number(messageLogs.total ?? stats.total_message_logs ?? 0)
    const queriesCount       = Number(messageLogs.rag_queries ?? 0)
    const kbDocsUsed         = Number(
      (stats.knowledgebase_docs ?? 0) + (stats.datastore_docs ?? 0) || stats.total_documents || 0
    )
    const engagementRate = totalMembers > 0
      ? Math.round((activeMembers / totalMembers) * 1000) / 10
      : 0

    return [
      { label: t.sbTotalConversations, value: totalConversations, icon: <MessageSquare className="w-4 h-4" /> },
      { label: t.sbActiveMembers,      value: activeMembers,      icon: <Users          className="w-4 h-4" /> },
      { label: t.sbQueriesCount,       value: queriesCount,       icon: <Search         className="w-4 h-4" /> },
      { label: t.sbKbDocsUsed,         value: kbDocsUsed,         icon: <FileText       className="w-4 h-4" /> },
      { label: t.sbEngagementRate,     value: engagementRate, unit: "%", icon: <TrendingUp className="w-4 h-4" /> },
    ]
  }, [isSecondBrain, sbProfile, t])

  const kpiExportRows = useMemo(() => {
    if (!overview) return []
    return [
      {
        solution: selectedSolution ?? "all",
        from: dateRange.from,
        to:   dateRange.to,
        totalEvaluations:     overview.totalEvaluations,
        avgScore:             overview.avgScore,
        passRate:             overview.passRate,
        passedEvaluations:    overview.passedEvaluations,
        prevTotalEvaluations: overview.prevTotalEvaluations,
        prevAvgScore:         overview.prevAvgScore,
        prevPassRate:         overview.prevPassRate,
        deltaTotalEvaluations: calcDeltaPct(overview.totalEvaluations,  overview.prevTotalEvaluations),
        deltaAvgScore:         calcDeltaPct(overview.avgScore,           overview.prevAvgScore, 1),
        deltaPassRate:         calcDeltaPct(overview.passRate,           overview.prevPassRate, 1),
        deltaPassedEvaluations: calcDeltaPct(
          overview.passedEvaluations,
          estimatePassedSessions(overview.prevTotalEvaluations, overview.prevPassRate)
        ),
      },
    ]
  }, [overview, selectedSolution, dateRange.from, dateRange.to])

  const activityData = useMemo(() => trends?.evalCountTrend ?? [], [trends])

  const donutData = useMemo(() => {
    if (!ucBreakdown?.data?.length) return []
    return ucBreakdown.data.map((row) => ({
      name:  row.usecase_name?.trim() || `UC-${row.usecaseId}`,
      value: row.totalEvaluations,
    }))
  }, [ucBreakdown])

  const moduleBreakdownData = useMemo(() => {
    if (!ucBreakdown?.data?.length) return []
    return ucBreakdown.data.map(row => ({
      module:   row.usecase_name?.trim() || `UC-${row.usecaseId}`,
      sessions: row.totalEvaluations,
      passed:   row.passed,
    }))
  }, [ucBreakdown])

  const ucNameMap = useMemo(() => {
    const m = new Map<number, string>()
    if (ucBreakdown?.data) {
      for (const row of ucBreakdown.data) {
        if (row.usecaseId != null && row.usecase_name?.trim()) {
          m.set(row.usecaseId, row.usecase_name.trim())
        }
      }
    }
    return m
  }, [ucBreakdown])

  // ── Evaluation results table columns ─────────────────────────────────────
  const evalColumns: Column<EvaluationApiRow>[] = [
    {
      key: "savedReportId",
      header: t.colReportId,
      render: r => (
        <Link
          href={`/drilldown/${r.savedReportId}`}
          className="font-medium font-mono text-xs hover:underline underline-offset-2 text-primary"
        >
          #{r.savedReportId}
        </Link>
      ),
    },
    {
      key: "usecaseId",
      header: t.colUsecaseId,
      render: r => {
        if (r.usecaseId == null) return <span className="text-muted-foreground">—</span>
        const name = ucNameMap.get(r.usecaseId)
        return name
          ? <span className="text-xs font-medium">{name}</span>
          : <span className="text-muted-foreground text-xs">UC-{r.usecaseId}</span>
      },
    },
    {
      key: "score",
      header: t.colAvgScore,
      render: r => r.score != null
        ? <span className="tabular-nums font-semibold">{r.score} pts</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "passed",
      header: t.colResult,
      render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
          r.passed
            ? "bg-primary/10 text-primary"
            : "bg-destructive/10 text-destructive"
        )}>
          {r.passed ? t.passLabel : t.failLabel}
        </span>
      ),
    },
    {
      key: "date",
      header: t.colDate,
      render: r => <span className="text-muted-foreground text-xs">{r.date}</span>,
    },
  ]

  const isLoading = overviewLoading || shimmer

  const exportAllLabel = t.exportAll
  const exportingLabel = t.exporting

  // ── Early returns (all hooks above — no more hooks below this line) ────────

  // Access check still loading
  if (user !== null && accessLoading) {
    return (
      <div className="min-h-screen w-full">
        <DashboardHeader title={t.overviewTitle} subtitle={t.overviewSub} showModuleFilter />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          <p className="mt-4 text-sm text-muted-foreground">{t.loadingAccess}</p>
        </div>
      </div>
    )
  }

  if (user !== null && accessStatus !== null) {
    // No access to any module
    if (!accessStatus.hasAnyAccess) {
      return (
        <div className="min-h-screen w-full">
          <DashboardHeader title={t.overviewTitle} subtitle={t.overviewSub} showModuleFilter />
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
              <BarChart2 className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-3">{t.notLinkedToOrg}</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">{t.notLinkedToOrgSub}</p>
            <a
              href="mailto:info@rolplay.ai"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t.notLinkedContact}
            </a>
            <p className="mt-4 text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      )
    }

    // Has access to Second Brain only — user tries a DB module
    const isCoachModule = selectedSolution &&
      ["lms", "coach", "simulator", "certification"].includes(selectedSolution)

    if (isCoachModule && !accessStatus.hasCoachData && !accessStatus.hasPharmaAccess) {
      return (
        <div className="min-h-screen w-full">
          <DashboardHeader title={t.overviewTitle} subtitle={t.overviewSub} showModuleFilter />
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-6">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-3">{t.partialAccessTitle}</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">{t.partialAccessSub}</p>
            {accessStatus.hasSecondBrainData && (
              <Link
                href="?solution=second-brain"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t.goToSecondBrain}
              </Link>
            )}
          </div>
        </div>
      )
    }

    // Has DB access only — user tries Second Brain module
    if (isSecondBrain && !accessStatus.hasSecondBrainData) {
      return (
        <div className="min-h-screen w-full">
          <DashboardHeader title={t.overviewTitle} subtitle={t.overviewSub} showModuleFilter />
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-6">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-3">{t.moduleNotAvailable}</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">{t.partialAccessSub}</p>
            {accessStatus.hasCoachData && (
              <Link
                href="?solution=lms"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t.goToLms}
              </Link>
            )}
          </div>
        </div>
      )
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full">
      <DashboardHeader
        title={t.overviewTitle}
        subtitle={t.overviewSub}
        showModuleFilter
      />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6 sm:space-y-8 max-w-[1600px] mx-auto">

        {/* Active solution badge */}
        <AnimatePresence>
          {selectedSolution && (
            <motion.div
              key="solution-badge"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2 text-sm font-medium text-primary"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-primary" />
              {t.themeShowing}{" "}
              <span className="capitalize font-bold">
                {selectedSolution.replace("-", " ")}
              </span>
              <button
                onClick={() => useDashboardStore.getState().setSolution(null)}
                className="ml-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {t.themeClear}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* API error banners */}
        {overviewError && <ErrorBanner message={`${t.errorLoading}: ${overviewError}`} />}
        {trendsError   && <ErrorBanner message={`${t.errorLoading} (trends): ${trendsError}`} />}
        {ucError       && <ErrorBanner message={`${t.errorLoading} (breakdown): ${ucError}`} />}
        {resultsError  && <ErrorBanner message={`${t.errorLoading} (results): ${resultsError}`} />}

        {isSecondBrain ? (
          <>
            {sbError && <ErrorBanner message={`${t.errorLoading}: ${sbError}`} />}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
              {sbLoading
                ? Array.from({ length: 5 }).map((_, i) => <KpiSkeleton key={i} />)
                : secondBrainKpis.length > 0
                  ? secondBrainKpis.map((kpi) => (
                      <MetricCard
                        key={kpi.label}
                        label={kpi.label}
                        value={kpi.value}
                        unit={kpi.unit}
                        icon={kpi.icon}
                      />
                    ))
                  : (
                    <div className="sm:col-span-2 lg:col-span-5">
                      <EmptyState message={t.noDataAvailable} />
                    </div>
                  )}
            </div>

            <div className="rounded-[16px] border border-border/60 bg-card p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.06),0_4px_6px_-4px_rgba(0,0,0,0.04)] transition-all duration-200">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold">{t.sbTitle}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">{t.sbSub}</p>
                </div>
                <Link
                  href="/second-brain"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-border/60 bg-muted/60 hover:bg-muted transition-all duration-200"
                >
                  {t.navSecondBrain}
                </Link>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* KPI export row — fixed width (not min-width) on BOTH buttons, plus
                identical padding/text-size/radius via ExportButton's className
                override, so they stay pixel-identical regardless of language
                (the Spanish labels are noticeably longer than the English ones). */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:justify-end">
              <button
                onClick={() => exportAllSolutions()}
                disabled={exportLoading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold w-full sm:w-[220px] whitespace-nowrap bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                title={exportAllLabel}
              >
                {exportLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
                    {exportingLabel}
                  </>
                ) : (
                  <>
                    <BarChart2 className="w-4 h-4 shrink-0" />
                    {exportAllLabel}
                  </>
                )}
              </button>
              <ExportButton
                data={kpiExportRows}
                filename={csvFilename(`kpi-summary-${selectedSolution ?? "all"}`)}
                label={t.exportCurrent}
                minWidth="w-full sm:w-[220px]"
                className="!px-4 !py-2.5 !text-sm !rounded-xl !gap-2"
                columns={[
                  { header: "Solution",              value: (r) => r.solution },
                  { header: "From",                  value: (r) => r.from },
                  { header: "To",                    value: (r) => r.to },
                  { header: "Total Evaluations",     value: (r) => r.totalEvaluations },
                  { header: "Avg Score",             value: (r) => r.avgScore },
                  { header: "Pass Rate (%)",         value: (r) => r.passRate },
                  { header: "Passed Evaluations",    value: (r) => r.passedEvaluations },
                  { header: "Prev Total Evaluations",value: (r) => r.prevTotalEvaluations },
                  { header: "Prev Avg Score",        value: (r) => r.prevAvgScore },
                  { header: "Prev Pass Rate (%)",    value: (r) => r.prevPassRate },
                  { header: "Δ Total (%)",           value: (r) => r.deltaTotalEvaluations },
                  { header: "Δ Avg Score (%)",       value: (r) => r.deltaAvgScore },
                  { header: "Δ Pass Rate (%)",       value: (r) => r.deltaPassRate },
                  { header: "Δ Passed (%)",          value: (r) => r.deltaPassedEvaluations },
                ]}
              />
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
                : kpiCards.length > 0
                  ? kpiCards.map((kpi, i) => (
                      <SummaryCard
                        key={`${selectedSolution ?? "all"}-${kpi.label}`}
                        kpi={kpi}
                        index={i}
                        icon={kpiIcons[i]}
                      />
                    ))
                  : Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-[16px] border border-border/60 bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]"
                      >
                        <div className="h-[3px] bg-primary" />
                        <div className="p-5 sm:p-6 text-center text-sm text-muted-foreground py-10">
                          {t.noDataAvailable}
                        </div>
                      </div>
                    ))
              }
            </div>

            {/* Main Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
              <ChartCard
                title={t.activityTrend}
                subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}
                className="lg:col-span-2"
              >
                {shimmer || trendsLoading
                  ? <ChartSkeleton />
                  : activityData.length > 0
                    ? <ActivityLineChart data={activityData} label="Evaluations" color={brand.chartColors[0]} />
                    : <EmptyState />
                }
              </ChartCard>
              <ChartCard
                title={t.moduleDistribution}
                subtitle={`${t.moduleDistSub} — ${days}d`}
              >
                {shimmer || ucLoading
                  ? <ChartSkeleton />
                  : donutData.length > 0
                    ? <DonutChart data={donutData} />
                    : <EmptyState />
                }
              </ChartCard>
            </div>

            {/* Module Breakdown */}
            <ChartCard
              title={t.sessionsByModule}
              subtitle={`${t.sessionsByModuleSub} — ${t.last} ${days} ${t.days}`}
            >
              {shimmer || ucLoading
                ? <ChartSkeleton />
                : moduleBreakdownData.length > 0
                  ? <ModuleBarChart data={moduleBreakdownData} sessionsColor={brand.chartColors[0]} passedColor={brand.chartColors[1]} />
                  : <EmptyState />
              }
            </ChartCard>

            {/* Best Performers */}
            {(bestLoading || (bestPerformers?.data?.length ?? 0) > 0) && (
              <div className="rounded-[16px] border border-border/60 bg-card p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.06),0_4px_6px_-4px_rgba(0,0,0,0.04)] transition-all duration-200">
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
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 ml-10">
                    {t.bestPerformersSub} — {t.last} {days} {t.days}
                  </p>
                </div>

                {/* All-time stats — only present for tenants with a real source for it (e.g. Sanfer's sim.topstats) */}
                {bestPerformers?.allTimeStats && (
                  <div className="ml-10 mb-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                    <span className="text-muted-foreground">
                      {t.totalRecordsAllTime}: <span className="font-semibold text-foreground tabular-nums">{bestPerformers.allTimeStats.totalRecords.toLocaleString()}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {t.avgBestScoreAllTime}: <span className="font-semibold text-foreground tabular-nums">{bestPerformers.allTimeStats.avgBestScore} pts</span>
                    </span>
                    <span className="text-muted-foreground">
                      {t.recordsGe80Label}: <span className="font-semibold text-primary tabular-nums">{bestPerformers.allTimeStats.recordsGe80.toLocaleString()}</span>
                    </span>
                  </div>
                )}

                {bestLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
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
                ) : (
                  <div className="space-y-2">
                    {bestPerformers!.data.map((performer: BestPerformerRow, idx: number) => {
                      const passRateDisplay = Number(performer.pass_rate).toFixed(1)
                      const avgScoreDisplay = Number(performer.avg_score).toFixed(1)
                      const displayName = performer.user_name?.trim()
                        ? performer.user_name.trim()
                        : performer.user_email

                      return (
                        <div
                          key={`${performer.user_email}-${idx}`}
                          className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-all duration-200 gap-3"
                        >
                          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                            <div
                              className={cn(
                                "flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl font-bold text-xs sm:text-sm shrink-0",
                                idx === 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 shadow-sm"
                                : idx === 1 ? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 shadow-sm"
                                : idx === 2 ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 shadow-sm"
                                : "bg-primary/10 text-primary"
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
                              <p className="text-sm font-bold text-primary tabular-nums">{passRateDisplay}%</p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Score Distribution — only present for tenants where it can be computed from raw session rows */}
            {(trends?.scoreDistribution?.length ?? 0) > 0 && (
              <div className="rounded-[16px] border border-border/60 bg-card p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
                <div className="mb-5">
                  <h3 className="text-base sm:text-lg font-semibold">{t.scoreDistribution}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1.5">{t.scoreDistributionSub}</p>
                </div>
                <div className="space-y-2">
                  {trends!.scoreDistribution!.map(bucket => (
                    <div key={bucket.range} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs font-medium text-muted-foreground tabular-nums">{bucket.range}</span>
                      <div className="flex-1 h-5 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(bucket.pct, bucket.count > 0 ? 2 : 0)}%`, background: `linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))` }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-xs text-right tabular-nums">
                        <span className="font-semibold">{bucket.count}</span>
                        <span className="text-muted-foreground"> ({bucket.pct}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent evaluations table */}
            <div className="rounded-[16px] border border-border/60 bg-card p-5 sm:p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_10px_15px_-3px_rgba(0,0,0,0.06),0_4px_6px_-4px_rgba(0,0,0,0.04)] transition-all duration-200">
              <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold">{t.evaluationResults}</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                    {resultsLoading
                      ? t.loading
                      : `${results?.data?.length ?? 0} ${t.evaluationsSub} ${days} ${t.days}`}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 self-start sm:self-auto text-[11px] font-semibold bg-primary/10 text-primary px-3 py-1.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  {t.liveLabel}
                </span>
              </div>
              {resultsLoading
                ? <TableSkeleton rows={5} />
                : results?.data?.length
                  ? <DataTable data={results.data} columns={evalColumns} pageSize={10} />
                  : <div className="py-12 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
                        <BarChart2 className="w-8 h-8 text-muted-foreground/50" />
                      </div>
                      <p className="text-sm text-muted-foreground">{t.noDataAvailable}</p>
                    </div>
              }
            </div>
          </>
        )}
      </div>
    </div>
  )
}
