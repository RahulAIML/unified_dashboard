"use client"

import { MessageSquare, Users, Play, BookOpen, BarChart2, AlertTriangle, Database, FileType, Layers } from "lucide-react"
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

// ── Real API types (from second-brain-shz8.onrender.com) ─────────────────────

interface SBStats {
  total_members:           number   // 18
  active_members:          number   // 18
  total_documents:         number   // 0
  knowledgebase_docs:      number
  datastore_docs:          number
  total_roles:             number
  total_groups:            number
  total_coaching_scenarios: number  // 2
  total_coaching_sessions: number   // 13
  total_message_logs:      number   // 36  ← "Total Interactions"
  total_whatsapp_messages: number   // 63
  total_broadcasts:        number
}

interface SBMember {
  profile_id:       string
  user_id:          string
  email:            string
  username:         string
  full_name:        string
  job_title?:       string
  whatsapp_number?: string
  role_name?:       string
  is_active:        boolean
  created_at:       string
}

interface SBScenario {
  id:           string
  name:         string
  description?: string
  is_active:    boolean
  session_count: number
  created_at:   string
  reference_files?: { id: string; file_name: string }[]
}

interface SBSession {
  id:            string
  phone_number:  string
  scenario_name: string
  started_at:    string
  ended_at:      string | null
  report_text:   string | null
  created_at:    string
}

interface SBMessageLog {
  total:         number
  recent_30_days: number
  rag_queries:   number
  errors:        number
  by_type:       Record<string, number>
}

interface SBProfile {
  organization?:       { id: string; name: string; owner_email: string; created_at: string }
  stats?:              SBStats
  members?:            SBMember[]
  coaching_scenarios?: SBScenario[]
  coaching_sessions?:  SBSession[]
  message_logs?:       SBMessageLog
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const sbIcons = [
  <MessageSquare key="m" className="w-4 h-4" />,
  <Users         key="u" className="w-4 h-4" />,
  <Play          key="p" className="w-4 h-4" />,
  <BookOpen      key="b" className="w-4 h-4" />,
]

const dbIcons = [
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
  const t   = useT()
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  // ── Legacy RolPlay DB data ────────────────────────────────────────────────
  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to, { solution: "second-brain", clientId, rk: refreshKey })
  const trendsUrl   = buildApiUrl("/api/dashboard/trends",   dateRange.from, dateRange.to, { solution: "second-brain", clientId, rk: refreshKey })
  const ucUrl       = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to, { solution: "second-brain", clientId, rk: refreshKey })

  const { data: overview,    loading: overviewLoading, error: overviewError } = useApi<OverviewApiResponse>(overviewUrl)
  const { data: trends,      loading: trendsLoading,   error: trendsError }   = useApi<TrendsApiResponse>(trendsUrl)
  const { data: ucBreakdown, loading: ucLoading,       error: ucError }       = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  // ── Second Brain hosted API ───────────────────────────────────────────────
  const { data: sbProfile, loading: sbLoading, error: sbError } = useApi<SBProfile>("/api/second-brain/profile")

  // ── KPIs: prefer live Second Brain API, fallback to DB ───────────────────
  const sbKpis = useMemo(() => {
    const s = sbProfile?.stats
    if (!s) return null

    // Map to same KPI structure as DB view:
    //   Total Interactions  → total_message_logs  (WhatsApp messages to the AI)
    //   Active Members      → active_members
    //   Coaching Sessions   → total_coaching_sessions
    //   Scenarios           → total_coaching_scenarios
    return [
      {
        label: "Total Interactions", labelKey: "practiceSessions" as const,
        value: s.total_message_logs,
        delta: 0,
        tier: "A" as const,
      },
      {
        label: "Active Members", labelKey: "totalSessions" as const,
        value: s.active_members,
        delta: s.total_members > 0
          ? Math.round((s.active_members / s.total_members) * 100)
          : 0,
        unit: "%",
        tier: "B" as const,
      },
      {
        label: "Coaching Sessions", labelKey: "passRate" as const,
        value: s.total_coaching_sessions,
        delta: 0,
        tier: "A" as const,
      },
      {
        label: "Scenarios", labelKey: "avgScore" as const,
        value: s.total_coaching_scenarios,
        delta: 0,
        tier: "B" as const,
      },
    ]
  }, [sbProfile])

  // ── Fallback: DB KPIs if Second Brain API is down ────────────────────────
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

  const kpis     = sbKpis ?? dbKpis
  const kpiIcons = sbKpis ? sbIcons : dbIcons
  const isLive   = Boolean(sbKpis)

  const activityData = useMemo(() => trends?.evalCountTrend ?? [], [trends])

  // ── Members table columns ─────────────────────────────────────────────────
  const memberColumns: Column<SBMember>[] = useMemo(() => [
    { key: "full_name",       header: "Name",      render: r => <span className="font-medium">{r.full_name}</span> },
    { key: "job_title",       header: "Job Title",  render: r => <span className="text-muted-foreground">{r.job_title ?? "—"}</span> },
    { key: "role_name",       header: "Role",       render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize",
          r.role_name === "Admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}>{r.role_name ?? "—"}</span>
      ),
    },
    { key: "whatsapp_number", header: "WhatsApp",   render: r => <span className="tabular-nums text-xs">{r.whatsapp_number ?? "—"}</span> },
    { key: "is_active",       header: "Status",     render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.is_active ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
        )}>{r.is_active ? "Active" : "Inactive"}</span>
      ),
    },
  ], [])

  // ── Scenario table columns ────────────────────────────────────────────────
  const scenarioColumns: Column<SBScenario>[] = useMemo(() => [
    { key: "name",          header: "Scenario",  render: r => <span className="font-medium">{r.name}</span> },
    { key: "session_count", header: "Sessions",  render: r => <span className="tabular-nums">{r.session_count}</span> },
    { key: "is_active",     header: "Status",    render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}>{r.is_active ? "Active" : "Inactive"}</span>
      ),
    },
    { key: "reference_files", header: "KB Files", render: r => (
        <span className="tabular-nums">{r.reference_files?.length ?? 0}</span>
      ),
    },
  ], [])

  // ── Use-case breakdown columns (DB) ──────────────────────────────────────
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

  const members   = sbProfile?.members   ?? []
  const scenarios = sbProfile?.coaching_scenarios ?? []

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.sbTitle} subtitle={t.sbSub} />
      <div className="p-6 space-y-6">

        {/* Error banners */}
        {sbError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Second Brain live data unavailable — showing evaluation DB data. ({sbError})</span>
          </div>
        )}
        {overviewError && !isLive && <ErrorBanner message={`${t.errorLoading}: ${overviewError}`} />}

        {/* Source badge */}
        {!sbLoading && (
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded",
              isLive
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}>
              {isLive ? "🔗 Live · Second Brain API" : "📊 Evaluation DB fallback"}
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

        {/* Members table — from Second Brain API */}
        {(isLive || sbLoading) && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Members
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sbLoading ? t.loading : `${members.length} enrolled members`}
                  <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    Second Brain API
                  </span>
                </p>
              </div>
              <ExportButton
                data={members}
                filename={csvFilename("second-brain-members")}
                columns={[
                  { header: "Name",        value: r => r.full_name },
                  { header: "Job Title",   value: r => r.job_title },
                  { header: "Role",        value: r => r.role_name },
                  { header: "WhatsApp",    value: r => r.whatsapp_number },
                  { header: "Active",      value: r => r.is_active ? "Yes" : "No" },
                  { header: "Created",     value: r => r.created_at?.slice(0, 10) },
                ]}
              />
            </div>
            {sbLoading
              ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
              : members.length > 0
                ? <DataTable data={members} columns={memberColumns} pageSize={10} />
                : <div className="py-10 text-center text-sm text-muted-foreground">No members found</div>
            }
          </div>
        )}

        {/* Scenarios table — from Second Brain API */}
        {(isLive || sbLoading) && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Play className="w-4 h-4 text-primary" />
                  Coaching Scenarios
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sbLoading ? t.loading : `${scenarios.length} scenarios`}
                  <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    Second Brain API
                  </span>
                </p>
              </div>
              <ExportButton
                data={scenarios}
                filename={csvFilename("second-brain-scenarios")}
                columns={[
                  { header: "Scenario",  value: r => r.name },
                  { header: "Sessions",  value: r => r.session_count },
                  { header: "Active",    value: r => r.is_active ? "Yes" : "No" },
                  { header: "KB Files",  value: r => r.reference_files?.length ?? 0 },
                  { header: "Created",   value: r => r.created_at?.slice(0, 10) },
                ]}
              />
            </div>
            {sbLoading
              ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
              : scenarios.length > 0
                ? <DataTable data={scenarios} columns={scenarioColumns} pageSize={10} />
                : <div className="py-10 text-center text-sm text-muted-foreground">No scenarios found</div>
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
