"use client"

import { useMemo } from "react"
import Link from "next/link"
import { BadgeCheck, TrendingUp, Award, Users, BarChart2, AlertTriangle } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { StackedBarChart } from "@/components/charts/StackedBarChart"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { calcDeltaPct, estimatePassedSessions } from "@/lib/kpi-builder"
import { csvFilename } from "@/lib/csv-export"
import { cn } from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  ResultsApiResponse,
  EvaluationApiRow,
  BusinessLinesApiResponse,
  BusinessLineRow,
  OrganizationApiResponse,
  OrgMemberRow,
} from "@/lib/types"

const icons = [
  <BadgeCheck key="b" className="w-4 h-4" />,
  <TrendingUp key="t" className="w-4 h-4" />,
  <Award      key="a" className="w-4 h-4" />,
  <Users      key="u" className="w-4 h-4" />,
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

export default function CertificationPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t     = useT()
  const brand = useClientBrand()
  const days = Math.round(
    (dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000
  )

  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: "certification", rk: refreshKey })
  const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to, { solution: "certification", rk: refreshKey })
  const resultsUrl  = buildApiUrl("/api/dashboard/results",  dateRange.from, dateRange.to, { limit: 100, solution: "certification", rk: refreshKey })
  const linesUrl    = buildApiUrl("/api/dashboard/business-lines", dateRange.from, dateRange.to, { rk: refreshKey })
  const orgUrl      = buildApiUrl("/api/dashboard/organization", dateRange.from, dateRange.to, { rk: refreshKey })

  const { data: overview, loading: overviewLoading, error: overviewError } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,   loading: trendsLoading,   error: trendsError }   = useApi<TrendsApiResponse>(trendsUrl)
  const { data: results,  loading: resultsLoading,  error: resultsError }  = useApi<ResultsApiResponse>(resultsUrl)
  const { data: lines,    loading: linesLoading }                          = useApi<BusinessLinesApiResponse>(linesUrl)
  const { data: org,      loading: orgLoading }                            = useApi<OrganizationApiResponse>(orgUrl)

  const hasData = overview && overview.totalEvaluations > 0

  const kpis = useMemo(() => {
    if (!hasData) return []
    // cert.stats is a current-state snapshot with no date range — there is no
    // real "previous period" to diff against, so every delta here would be a
    // fabricated 0% that looks identical to a real "no change" trend.
    return [
      {
        label: "Candidates Evaluated", labelKey: "candidatesEvaluated" as const,
        value: overview!.totalEvaluations,
        delta: 0, noComparison: true,
        tier: "A" as const,
      },
      {
        label: "Pass Rate", labelKey: "passRate" as const,
        value: overview!.passRate ?? 0, unit: "%",
        delta: 0, noComparison: true,
        tier: "B" as const,
      },
      {
        label: "Avg Score", labelKey: "avgScore" as const,
        value: overview!.avgScore ?? 0, unit: "pts",
        delta: 0, noComparison: true,
        tier: "B" as const,
      },
      {
        label: "Certified Users", labelKey: "certifiedUsers" as const,
        value: overview!.passedEvaluations,
        delta: 0, noComparison: true,
        tier: "A" as const,
      },
    ]
  }, [overview, hasData])

  const passFailData  = useMemo(() => trends?.passFailTrend ?? [],  [trends])
  const scoreTrend    = useMemo(() => trends?.scoreTrend ?? [],      [trends])

  const columns: Column<EvaluationApiRow>[] = useMemo(() => [
    {
      key: "savedReportId",
      header: t.colReportId,
      render: r => r.savedReportId > 0 ? (
        <Link
          href={`/drilldown/${r.savedReportId}`}
          className="font-medium font-mono text-xs hover:underline underline-offset-2 text-primary"
        >
          #{r.savedReportId}
        </Link>
      ) : (
        // Negative IDs are synthesized for certification rows (profiles_assigned
        // has no per-event ID) — no real drilldown exists, so don't link one.
        <span className="font-medium font-mono text-xs text-muted-foreground">—</span>
      ),
    },
    {
      key: "usecaseId",
      header: t.colUsecaseId,
      render: r => (
        <span className="text-muted-foreground text-xs">
          {r.usecaseName || (r.usecaseId != null ? `UC-${r.usecaseId}` : "—")}
        </span>
      ),
    },
    {
      key: "score",
      header: t.colScore,
      render: r => r.score != null
        ? (
          <span className={cn(
            "tabular-nums font-semibold",
            r.score >= 80 ? "text-primary"
              : r.score >= 60 ? "text-foreground"
              : "text-amber-600"
          )}>
            {r.score} pts
          </span>
        )
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
      key: "result",
      header: t.colSegment,
      render: r => <span className="text-muted-foreground text-xs">{r.result ?? "—"}</span>,
    },
    {
      key: "date",
      header: t.colDate,
      render: r => <span className="text-muted-foreground text-xs">{r.date}</span>,
    },
  ], [t])

  const lineColumns: Column<BusinessLineRow>[] = useMemo(() => [
    { key: "name", header: t.colLine, render: r => <span className="font-medium text-sm capitalize">{r.name}</span> },
    { key: "memberCount", header: t.colMembers, render: r => <span className="tabular-nums font-medium">{r.memberCount}</span> },
    { key: "simCount", header: t.colSimCount, render: r => <span className="tabular-nums font-medium">{r.simCount}</span> },
    {
      key: "avgScore", header: t.colAvgScore,
      render: r => r.avgScore != null
        ? <span className="tabular-nums font-semibold">{r.avgScore} pts</span>
        : <span className="text-muted-foreground">—</span>,
    },
    { key: "activeUsers", header: t.colActiveUsers, render: r => <span className="tabular-nums text-primary font-semibold">{r.activeUsers}</span> },
  ], [t])

  const memberColumns: Column<OrgMemberRow>[] = useMemo(() => [
    { key: "fullName", header: t.colFullName, render: r => <span className="font-medium text-sm">{r.fullName}</span> },
    { key: "email", header: t.colEmail, render: r => <span className="text-muted-foreground text-xs">{r.email}</span> },
    { key: "designation", header: t.colDesignation, render: r => <span className="text-muted-foreground text-xs">{r.designation ?? "—"}</span> },
  ], [t])

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.certTitle} subtitle={t.certSub} />
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {overviewError && <ErrorBanner message={`${t.errorLoading}: ${overviewError}`} />}

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {overviewLoading
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
              ? kpis.map((kpi, i) => (
                  <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]} />
                ))
              : Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="h-[3px] bg-primary" />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">{t.noDataAvailable}</div>
                  </div>
                ))
          }
        </div>

        {/* Charts: pass/fail stacked + score trend */}
        {trendsError && <ErrorBanner message={`${t.errorLoading}: ${trendsError}`} />}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <ChartCard
            title={t.passFailOverTime}
            subtitle={`${t.passFailSub} — ${t.last} ${days} ${t.days}`}
          >
            {trendsLoading
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : passFailData.length > 0
                ? <StackedBarChart data={passFailData} passColor={brand.chartColors[0]} failColor={brand.chartColors[1]} />
                : <EmptyState />
            }
          </ChartCard>
          <ChartCard
            title={t.scoreTrend}
            subtitle={`${t.last} ${days} ${t.days}`}
          >
            {trendsLoading
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : scoreTrend.length > 0
                ? <ActivityLineChart data={scoreTrend} label={t.avgScore} color={brand.chartColors[0]} />
                : <EmptyState />
            }
          </ChartCard>
        </div>

        {/* Results table */}
        {resultsError && <ErrorBanner message={`${t.errorLoading}: ${resultsError}`} />}
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold">{t.evaluationResults}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {resultsLoading
                  ? t.loading
                  : `${results?.data?.length ?? 0} ${t.evaluationsSub} ${days} ${t.days}`}
                <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                  {t.sourceCert}
                </span>
              </p>
            </div>
            <ExportButton
              data={results?.data ?? []}
              filename={csvFilename("certification-results")}
              columns={[
                { header: "Report ID",     value: r => r.savedReportId },
                { header: "Exercise Name", value: r => r.usecaseName ?? "" },
                { header: "Use Case ID",   value: r => r.usecaseId },
                { header: "Score (pts)",   value: r => r.score },
                { header: "Result",        value: r => r.passed ? "PASS" : "FAIL" },
                { header: "Segment",       value: r => r.result },
                { header: "Date",          value: r => r.date },
              ]}
            />
          </div>
          <div className="p-5">
            {resultsLoading
              ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
              : results?.data?.length
                ? <DataTable data={results.data} columns={columns} pageSize={10} />
                : <div className="py-10 text-center text-sm text-muted-foreground">{t.noDataAvailable}</div>
            }
          </div>
        </div>

        {/* Business Lines — only rendered when a tenant has a real lines catalog */}
        {(linesLoading || (lines?.data?.length ?? 0) > 0) && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold">{t.businessLines}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{t.businessLinesSub}</p>
            </div>
            <div className="p-5">
              {linesLoading
                ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
                : <DataTable data={lines!.data} columns={lineColumns} pageSize={15} />
              }
            </div>
          </div>
        )}

        {/* Organization — only rendered when a tenant has a real members/admins source */}
        {(orgLoading || (org?.members?.length ?? 0) > 0) && (
          <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">{t.organization}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {orgLoading ? t.loading : `${org?.totalMembers ?? 0} ${t.colMembers.toLowerCase()} · ${org?.totalAdmins ?? 0} ${t.totalAdminsLabel.toLowerCase()} · ${org?.totalSupervisors ?? 0} ${t.totalSupervisorsLabel.toLowerCase()}`}
                </p>
              </div>
              <ExportButton
                data={org?.members ?? []}
                filename={csvFilename("organization-members")}
                columns={[
                  { header: "Name",        value: r => r.fullName },
                  { header: "Email",       value: r => r.email },
                  { header: "Designation", value: r => r.designation ?? "" },
                ]}
              />
            </div>
            <div className="p-5">
              {orgLoading
                ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
                : <DataTable data={org!.members} columns={memberColumns} pageSize={10} />
              }
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
