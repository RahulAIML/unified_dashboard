"use client"

import { Database, FileType, Layers, BarChart2, AlertTriangle, Users, BookOpen, Activity, CheckCircle } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { ChartCard } from "@/components/ChartCard"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  UsecaseApiRow,
} from "@/lib/types"
import { SummaryCard } from "@/components/SummaryCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { cn } from "@/lib/utils"
import { useMemo } from "react"
import { calcDeltaPct, estimatePassedSessions } from "@/lib/kpi-builder"
import { csvFilename } from "@/lib/csv-export"

// ── Types for the Second Brain external API ───────────────────────────────────

interface SBCourse {
  id: string | number
  name?: string
  title?: string
  enrolled_users?: number
  completion_rate?: number
  total_lessons?: number
  status?: string
}

interface SBUser {
  id: string | number
  name?: string
  email?: string
  role?: string
  status?: string
  last_active?: string
}

interface SBOrganization {
  id?: string | number
  name?: string
  total_users?: number
  active_users?: number
  total_courses?: number
}

interface SBProfileData {
  organization?: SBOrganization
  courses?: SBCourse[]
  users?: SBUser[]
  [key: string]: unknown
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const icons = [
  <Users     key="u" className="w-4 h-4" />,
  <BookOpen  key="b" className="w-4 h-4" />,
  <Activity  key="a" className="w-4 h-4" />,
  <CheckCircle key="c" className="w-4 h-4" />,
]

const oldIcons = [
  <Database  key="d" className="w-4 h-4" />,
  <FileType  key="f" className="w-4 h-4" />,
  <Layers    key="l" className="w-4 h-4" />,
  <BarChart2 key="b2" className="w-4 h-4" />,
]

function EmptyState({ label }: { label?: string }) {
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>{label ?? "No data available"}</span>
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function SecondBrainPage() {
  const { dateRange, clientId, refreshKey } = useDashboardStore()
  const t     = useT()
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  // ── Legacy RolPlay DB data (kept for eval trend / breakdown) ─────────────
  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: "second-brain", clientId, rk: refreshKey })
  const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to, { solution: "second-brain", clientId, rk: refreshKey })
  const ucUrl       = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: "second-brain", clientId, rk: refreshKey })

  const { data: overview, loading: overviewLoading, error: overviewError } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,   loading: trendsLoading,   error: trendsError }   = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown, loading: ucLoading,    error: ucError }       = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  // ── Second Brain hosted API data ─────────────────────────────────────────
  const { data: sbProfile, loading: sbLoading, error: sbError } = useApi<SBProfileData>("/api/second-brain/profile")

  // ── KPI cards from Second Brain API (preferred) or fallback to DB ─────────
  const sbKpis = useMemo(() => {
    if (!sbProfile) return null

    const org     = sbProfile.organization ?? {}
    const courses  = sbProfile.courses ?? []
    const users    = sbProfile.users ?? []

    const totalUsers   = org.total_users  ?? users.length
    const activeUsers  = org.active_users ?? users.filter((u: SBUser) => u.status === "active").length
    const totalCourses = org.total_courses ?? courses.length
    const avgCompletion = courses.length > 0
      ? Math.round(courses.reduce((s: number, c: SBCourse) => s + (c.completion_rate ?? 0), 0) / courses.length)
      : null

    return [
      {
        label: "Total Users",   labelKey: "practiceSessions" as const,
        value: totalUsers,      delta: 0, tier: "A" as const,
      },
      {
        label: "Active Users",  labelKey: "totalSessions" as const,
        value: activeUsers,     delta: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
        unit: totalUsers > 0 ? "%" : undefined,
        tier: "B" as const,
      },
      {
        label: "Total Courses", labelKey: "passRate" as const,
        value: totalCourses,    delta: 0, tier: "A" as const,
      },
      {
        label: "Avg Completion", labelKey: "avgScore" as const,
        value: avgCompletion ?? 0, unit: "%", delta: 0, tier: "B" as const,
      },
    ]
  }, [sbProfile])

  // ── Fallback KPIs from legacy DB ──────────────────────────────────────────
  const hasData = overview && overview.totalEvaluations > 0

  const dbKpis = useMemo(() => {
    if (!hasData) return []
    return [
      {
        label: "Total Interactions", labelKey: "practiceSessions" as const,
        value: overview!.totalEvaluations,
        delta: calcDeltaPct(overview!.totalEvaluations, overview!.prevTotalEvaluations),
        tier: "A" as const,
      },
      {
        label: "Pass Rate", labelKey: "passRate" as const,
        value: overview!.passRate ?? 0, unit: "%",
        delta: calcDeltaPct(overview!.passRate ?? 0, overview!.prevPassRate ?? 0),
        tier: "B" as const,
      },
      {
        label: "Avg Score", labelKey: "avgScore" as const,
        value: overview!.avgScore ?? 0, unit: "pts",
        delta: calcDeltaPct(overview!.avgScore ?? 0, overview!.prevAvgScore ?? 0),
        tier: "B" as const,
      },
      {
        label: "Passed Interactions", labelKey: "totalSessions" as const,
        value: overview!.passedEvaluations,
        delta: calcDeltaPct(
          overview!.passedEvaluations,
          estimatePassedSessions(overview!.prevTotalEvaluations, overview!.prevPassRate)
        ),
        tier: "A" as const,
      },
    ]
  }, [overview, hasData])

  // Prefer Second Brain API KPIs; fall back to DB KPIs
  const kpis      = sbKpis ?? dbKpis
  const kpiIcons  = sbKpis ? icons : oldIcons
  const kpiSource = sbKpis ? "second-brain-api" : "rolplay-db"

  const activityData = useMemo(
    () => trends?.evalCountTrend ?? [],
    [trends]
  )

  // ── Course table columns ──────────────────────────────────────────────────
  const courseColumns: Column<SBCourse>[] = useMemo(() => [
    { key: "name",            header: "Course",      render: r => <span className="font-medium">{r.name ?? r.title ?? `Course ${r.id}`}</span> },
    { key: "total_lessons",   header: "Lessons",     render: r => <span className="tabular-nums">{r.total_lessons ?? "—"}</span> },
    { key: "enrolled_users",  header: "Enrolled",    render: r => <span className="tabular-nums">{r.enrolled_users ?? "—"}</span> },
    {
      key: "completion_rate", header: "Completion",
      render: r => r.completion_rate != null ? (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.completion_rate >= 70 ? "bg-primary/10 text-primary"
            : r.completion_rate >= 40 ? "bg-secondary text-secondary-foreground"
            : "bg-destructive/10 text-destructive"
        )}>
          {r.completion_rate}%
        </span>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "status", header: "Status",
      render: r => <span className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize",
        r.status === "active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}>{r.status ?? "—"}</span>,
    },
  ], [])

  // ── Use-case table columns (legacy DB) ────────────────────────────────────
  const ucColumns: Column<UsecaseApiRow>[] = useMemo(() => [
    { key: "usecaseId",        header: t.colUseCase,  render: r => <span className="font-medium">UC-{r.usecaseId}</span> },
    { key: "totalEvaluations", header: t.colSessions, render: r => <span className="tabular-nums">{r.totalEvaluations}</span> },
    { key: "avgScore",         header: t.colAvgScore, render: r => r.avgScore != null ? <span className="tabular-nums">{r.avgScore} pts</span> : <span className="text-muted-foreground">—</span> },
    {
      key: "passRate", header: t.colPassRate,
      render: r => r.passRate != null ? (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.passRate >= 70 ? "bg-primary/10 text-primary"
            : r.passRate >= 50 ? "bg-secondary text-secondary-foreground"
            : "bg-destructive/10 text-destructive"
        )}>
          {r.passRate}%
        </span>
      ) : <span className="text-muted-foreground">—</span>,
    },
    { key: "passed", header: t.colPassed, render: r => <span className="tabular-nums">{r.passed}</span> },
  ], [t])

  const courses = sbProfile?.courses ?? []

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.sbTitle} subtitle={t.sbSub} />
      <div className="p-6 space-y-6">

        {/* Second Brain API status banner */}
        {sbError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Second Brain live data unavailable — showing evaluation data. ({sbError})</span>
          </div>
        )}

        {/* Error banners */}
        {overviewError && !sbKpis && <ErrorBanner message={`${t.errorLoading}: ${overviewError}`} />}

        {/* Source badge */}
        {!sbLoading && (
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded",
              kpiSource === "second-brain-api"
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}>
              {kpiSource === "second-brain-api" ? "🔗 Live from Second Brain API" : "📊 Evaluation DB data"}
            </span>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {(overviewLoading || sbLoading)
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                  <div className="h-[3px] bg-primary" />
                  <div className="p-5 space-y-3 animate-pulse">
                    <div className="h-3 w-24 rounded bg-muted" />
                    <div className="h-8 w-20 rounded bg-muted" />
                  </div>
                </div>
              ))
            : kpis.length > 0
              ? kpis.map((kpi, i) => <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={kpiIcons[i]} />)
              : Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="h-[3px] bg-primary" />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">No data available</div>
                  </div>
                ))
          }
        </div>

        {/* Course table — from Second Brain API */}
        {(sbKpis || sbLoading) && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  Courses
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sbLoading ? t.loading : `${courses.length} courses available`}
                  <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    Second Brain API
                  </span>
                </p>
              </div>
              <ExportButton
                data={courses}
                filename={csvFilename("second-brain-courses")}
                columns={[
                  { header: "Course",      value: r => r.name ?? r.title ?? r.id },
                  { header: "Lessons",     value: r => r.total_lessons },
                  { header: "Enrolled",    value: r => r.enrolled_users },
                  { header: "Completion%", value: r => r.completion_rate },
                  { header: "Status",      value: r => r.status },
                ]}
              />
            </div>
            {sbLoading
              ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
              : courses.length > 0
                ? <DataTable data={courses} columns={courseColumns} pageSize={10} />
                : <div className="py-10 text-center text-sm text-muted-foreground">No courses found</div>
            }
          </div>
        )}

        {/* Activity trend — from legacy DB */}
        {trendsError && <ErrorBanner message={`${t.errorLoading}: ${trendsError}`} />}
        <ChartCard title={t.activityTrend} subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}>
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : activityData.length > 0
              ? <ActivityLineChart data={activityData} label="Interactions" />
              : <EmptyState />
          }
        </ChartCard>

        {/* Use case breakdown — from legacy DB */}
        {ucError && <ErrorBanner message={`${t.errorLoading}: ${ucError}`} />}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">{t.usecaseBreakdown}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ucLoading ? t.loading : `${ucBreakdown?.data?.length ?? 0} ${t.usecaseBreakdownSub}`}
                <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                  {t.navSecondBrain}
                </span>
              </p>
            </div>
            <ExportButton
              data={ucBreakdown?.data ?? []}
              filename={csvFilename("second-brain-breakdown")}
              columns={[
                { header: "Use Case ID",        value: r => r.usecaseId },
                { header: "Total Interactions",  value: r => r.totalEvaluations },
                { header: "Avg Score (pts)",     value: r => r.avgScore },
                { header: "Pass Rate (%)",       value: r => r.passRate },
                { header: "Passed",              value: r => r.passed },
              ]}
            />
          </div>
          {ucLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : ucBreakdown?.data?.length
              ? <DataTable data={ucBreakdown.data} columns={ucColumns} pageSize={10} />
              : <div className="py-10 text-center text-sm text-muted-foreground">No data available</div>
          }
        </div>
      </div>
    </div>
  )
}
