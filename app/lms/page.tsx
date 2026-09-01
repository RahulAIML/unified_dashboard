"use client"

/**
 * LMS — course progress.
 *
 * This page used to read /api/dashboard/overview?solution=lms and relabel
 * Simulator fields: session count became "Enrolled Users", pass rate became
 * "Completion Rate", and the use-case table was captioned as courses. It now
 * reads /api/dashboard/lms, which talks to the real LearnWorlds school.
 *
 * Two things follow from an LMS being a roster rather than a stream of scored
 * sessions:
 *  - Counts are current-state, so the KPI cards carry `noComparison` instead of
 *    a period-over-period delta. Only the completion trend honours the range.
 *  - A missing score is rendered as "not graded", never as 0. LearnWorlds
 *    reports average_score_rate = 0 for ungraded courses, so the API sends null
 *    plus `hasScoreData` and the distinction has to survive to the screen.
 */

import { useMemo } from "react"
import { BookOpen, CheckCircle, Users, GraduationCap, BarChart2, AlertTriangle, Link2Off } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { LmsStatusBreakdown } from "@/components/LmsStatusBreakdown"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { csvFilename } from "@/lib/csv-export"
import { cn } from "@/lib/utils"
import type { LmsApiResponse, LmsCourseRow, KpiCard } from "@/lib/types"

const icons = [
  <Users        key="u" className="w-4 h-4" />,
  <CheckCircle  key="c" className="w-4 h-4" />,
  <GraduationCap key="g" className="w-4 h-4" />,
  <BookOpen     key="b" className="w-4 h-4" />,
]

function EmptyState() {
  const t = useT()
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>{t.noDataAvailable}</span>
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

/** Shown when the tenant has no LMS at all — distinct from "an LMS with no activity". */
function NotConfigured() {
  const t = useT()
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm px-6 py-16 flex flex-col items-center text-center gap-3">
      <Link2Off className="w-10 h-10 text-muted-foreground opacity-40" />
      <h3 className="text-base font-semibold">{t.lmsNotConfigured}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{t.lmsNotConfiguredHint}</p>
    </div>
  )
}

function CompletionBar({ value }: { value: number }) {
  const color =
    value >= 70 ? "bg-primary"
    : value >= 50 ? "bg-amber-500"
    : "bg-destructive"
  return (
    <div className="flex items-center gap-2">
      <span className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold min-w-[44px] justify-center",
        value >= 70 ? "bg-primary/10 text-primary"
          : value >= 50 ? "bg-amber-500/10 text-amber-600"
          : "bg-destructive/10 text-destructive"
      )}>
        {value}%
      </span>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  )
}

export default function LmsPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t     = useT()
  const brand = useClientBrand()

  const lmsUrl = buildApiUrl("/api/dashboard/lms", dateRange.from, dateRange.to, { rk: refreshKey })
  const { data, loading, error } = useApi<LmsApiResponse>(lmsUrl)

  const configured = data?.configured ?? true
  const hasEnrollments = (data?.totalEnrollments ?? 0) > 0

  const kpis = useMemo<KpiCard[]>(() => {
    if (!data || !data.configured) return []
    return [
      {
        label: "Enrolled Users", labelKey: "enrolledUsers",
        value: data.enrolledUsers,
        delta: 0, noComparison: true, tier: "A",
        info: t.enrolledUsersInfo,
      },
      {
        label: "Completion Rate", labelKey: "completionRate",
        // Null means "nothing to divide by", which is not 0%.
        value: data.completionRate ?? "—",
        unit: data.completionRate != null ? "%" : undefined,
        delta: 0, noComparison: true, tier: "B",
        info: t.completionRateInfo,
      },
      {
        label: "Avg Quiz Score", labelKey: "avgQuizScore",
        value: data.hasScoreData && data.avgQuizScore != null ? data.avgQuizScore : "—",
        unit: data.hasScoreData && data.avgQuizScore != null ? "%" : undefined,
        delta: 0, noComparison: true, tier: "B",
        info: t.avgQuizScoreInfo,
      },
      {
        label: "Modules Completed", labelKey: "modulesCompleted",
        value: data.modulesCompleted,
        delta: 0, noComparison: true, tier: "A",
        info: t.modulesCompletedInfo,
      },
    ]
  }, [data, t])

  const columns: Column<LmsCourseRow>[] = useMemo(() => [
    {
      key: "name", header: t.lmsColCourse,
      render: r => <span className="font-medium text-sm">{r.name}</span>,
    },
    {
      // The roster size (same number as the "of N users" sub-label above the
      // table) -- shown right after the course name, before Enrolled, so the
      // completion rate further right is legible as "completed out of this
      // many", not "out of however many enrolled".
      key: "totalUsers", header: t.lmsColTotal,
      render: r => <span className="tabular-nums text-muted-foreground">{r.totalUsers}</span>,
    },
    {
      key: "enrolled", header: t.lmsColEnrolled,
      render: r => <span className="tabular-nums font-medium">{r.enrolled}</span>,
    },
    {
      key: "completed", header: t.lmsColCompleted,
      render: r => <span className="tabular-nums text-primary font-semibold">{r.completed}</span>,
    },
    {
      key: "inProgress", header: t.lmsColInProgress,
      render: r => <span className="tabular-nums text-muted-foreground">{r.inProgress}</span>,
    },
    {
      key: "completionRate", header: t.completionRate,
      render: r => r.completionRate != null
        ? <CompletionBar value={r.completionRate} />
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "avgScore", header: t.avgQuizScore,
      // "—" here means the course has no graded units, not a score of zero.
      render: r => r.avgScore != null ? (
        <span className={cn(
          "tabular-nums font-semibold",
          r.avgScore >= 80 ? "text-primary"
            : r.avgScore >= 60 ? "text-foreground"
            : "text-amber-600"
        )}>
          {r.avgScore}%
        </span>
      ) : (
        <span className="text-xs text-muted-foreground italic">{t.lmsNotGraded}</span>
      ),
    },
  ], [t])

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.lmsTitle} subtitle={t.lmsSub} />
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {error && <ErrorBanner message={`${t.errorLoading}: ${error}`} />}

        {!loading && !error && !configured ? (
          <NotConfigured />
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                      <div className="h-[3px] bg-primary" />
                      <div className="p-5 space-y-3 animate-pulse">
                        <div className="h-3 w-24 rounded bg-muted" />
                        <div className="h-8 w-20 rounded bg-muted" />
                        <div className="h-5 w-16 rounded bg-muted" />
                      </div>
                    </div>
                  ))
                : kpis.length > 0
                  ? kpis.map((kpi, i) => <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]} />)
                  : Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="h-[3px] bg-primary" />
                        <div className="p-5 text-center text-sm text-muted-foreground py-8">{t.noDataAvailable}</div>
                      </div>
                    ))
              }
            </div>

            {/* Roster context + the caveat when nothing is graded. */}
            {!loading && data?.configured && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span>{t.lmsOfUsers.replace("{total}", data.totalUsers.toLocaleString())}</span>
                <span aria-hidden="true">·</span>
                <span>{t.lmsEnrollmentsTotal.replace("{count}", data.totalEnrollments.toLocaleString())}</span>
                <span aria-hidden="true">·</span>
                <span>{data.totalCourses.toLocaleString()} {t.lmsCourses}</span>
                {hasEnrollments && !data.hasScoreData && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-500">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {t.lmsNoGradedAssessments}
                  </span>
                )}
              </div>
            )}

            {/* Completion trend + status breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <ChartCard
                title={t.lmsCompletionTrend}
                // This chart is a fixed, always-current 30-day window
                // (lib/lms-learnworlds.ts's lmsDashboard), independent of the
                // global date-range picker -- so the subtitle is a static
                // label, not built from `days`, which would otherwise show
                // whatever range happens to be selected elsewhere on the page.
                subtitle={t.lmsCompletionTrendSub}
              >
                {loading
                  ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
                  : data?.completionTrend?.length
                    ? <ActivityLineChart
                        data={data.completionTrend}
                        label={t.lmsStatusCompleted}
                        color={brand.chartColors[0]}
                      />
                    : <EmptyState />
                }
              </ChartCard>
              <ChartCard title={t.lmsEnrollmentStatus} subtitle={t.lmsEnrollmentStatusSub}>
                {loading
                  ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
                  : data
                    ? <LmsStatusBreakdown data={data} />
                    : <EmptyState />
                }
              </ChartCard>
            </div>

            {/* Per-course table */}
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold">{t.lmsCourses}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {loading ? t.loading : `${data?.courses?.length ?? 0} ${t.lmsCoursesSub}`}
                    <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                      {t.navLms}
                    </span>
                  </p>
                </div>
                <ExportButton
                  data={data?.courses ?? []}
                  filename={csvFilename("lms-courses")}
                  columns={[
                    { header: "Course",           value: r => r.name },
                    { header: "Course ID",        value: r => r.courseId },
                    { header: "Enrolled",         value: r => r.enrolled },
                    { header: "Completed",        value: r => r.completed },
                    { header: "In Progress",      value: r => r.inProgress },
                    { header: "Total Users",      value: r => r.totalUsers },
                    { header: "Completion Rate (%)", value: r => r.completionRate },
                    // Empty, not 0 — the course was never graded.
                    { header: "Avg Score (%)",    value: r => r.avgScore },
                  ]}
                />
                {/* Internal/temporary, evaluation only (see LmsApiResponse
                    .enrollments's docstring): exports the raw per-learner
                    rows a completion rate is actually built from. Only
                    present in demo mode -- absent entirely for a real
                    tenant, so this button self-hides for real data. */}
                {!!data?.enrollments?.length && (
                  <ExportButton
                    data={data.enrollments}
                    filename={csvFilename("lms-raw-enrollments")}
                    label={t.lmsExportRawLabel}
                    columns={[
                      { header: "User ID",       value: r => r.userId },
                      { header: "User Name",     value: r => r.userName },
                      { header: "User Email",    value: r => r.userEmail },
                      { header: "Course ID",     value: r => r.courseId },
                      { header: "Course Name",   value: r => r.courseName },
                      { header: "Status",        value: r => r.status },
                      { header: "Score",         value: r => r.score },
                      { header: "Completed At",  value: r => r.completedAt },
                    ]}
                  />
                )}
              </div>
              <div className="p-5">
                {loading
                  ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
                  : data?.courses?.length
                    ? <DataTable data={data.courses} columns={columns} pageSize={8} />
                    : <div className="py-10 text-center text-sm text-muted-foreground">{t.noDataAvailable}</div>
                }
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
