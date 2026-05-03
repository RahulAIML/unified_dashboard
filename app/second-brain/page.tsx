"use client"

import { useMemo } from "react"
import { MessageSquare, Users, Play, AlertTriangle, BookOpen, BarChart2 } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DonutChart } from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
import { ExportButton } from "@/components/ExportButton"
import { useApi } from "@/lib/hooks/useApi"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { useT } from "@/lib/lang-store"
import { csvFilename } from "@/lib/csv-export"
import { cn } from "@/lib/utils"

// ── Real API types (from second-brain-shz8.onrender.com) ─────────────────────

interface SBStats {
  total_members:            number
  active_members:           number
  total_documents:          number
  knowledgebase_docs:       number
  datastore_docs:           number
  total_roles:              number
  total_groups:             number
  total_coaching_scenarios: number
  total_coaching_sessions:  number
  total_message_logs:       number
  total_whatsapp_messages:  number
  total_broadcasts:         number
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
  id:                string
  name:              string
  description?:      string
  is_active:         boolean
  session_count:     number
  created_at:        string
  reference_files?:  { id: string; file_name: string }[]
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
  total:          number
  recent_30_days: number
  rag_queries:    number
  errors:         number
  by_type:        Record<string, number>
}

interface SBProfile {
  organization?:       { id: string; name: string; owner_email: string; created_at: string }
  stats?:              SBStats
  members?:            SBMember[]
  coaching_scenarios?: SBScenario[]
  coaching_sessions?:  SBSession[]
  message_logs?:       SBMessageLog
}

// ── Privacy helpers ───────────────────────────────────────────────────────────

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—"
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 2) return "••••••"
  const visible = digits.slice(-2)
  const masked  = "•".repeat(Math.max(digits.length - 2, 4))
  return masked + visible
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const sbIcons = [
  <MessageSquare key="m" className="w-4 h-4" />,
  <Users         key="u" className="w-4 h-4" />,
  <Play          key="p" className="w-4 h-4" />,
  <BookOpen      key="b" className="w-4 h-4" />,
]

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ label }: { label?: string }) {
  const t = useT()
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>{label ?? t.noDataAvailable}</span>
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

export default function SecondBrainPage() {
  const t     = useT()
  const brand = useClientBrand()

  // ── Second Brain hosted API ───────────────────────────────────────────────
  const { data: sbProfile, loading: sbLoading, error: sbError } = useApi<SBProfile>("/api/second-brain/profile")

  const isLive = Boolean(sbProfile?.stats)

  // ── KPI cards ─────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const s = sbProfile?.stats
    if (!s) return []
    return [
      {
        label: "Total Interactions", labelKey: "sbTotalInteractions" as const,
        value: s.total_message_logs,
        delta: 0,
        tier: "A" as const,
      },
      {
        label: "Active Members", labelKey: "sbActiveMembers" as const,
        value: s.active_members,
        delta: s.total_members > 0
          ? Math.round((s.active_members / s.total_members) * 100)
          : 0,
        unit: "%",
        tier: "B" as const,
      },
      {
        label: "Coaching Sessions", labelKey: "sbCoachingSessions" as const,
        value: s.total_coaching_sessions,
        delta: 0,
        tier: "A" as const,
      },
      {
        label: "Scenarios", labelKey: "sbScenarios" as const,
        value: s.total_coaching_scenarios,
        delta: 0,
        tier: "B" as const,
      },
    ]
  }, [sbProfile])

  // ── Chart data: Sessions per day ──────────────────────────────────────────
  const sessionsPerDay = useMemo(() => {
    const sessions = sbProfile?.coaching_sessions ?? []
    if (!sessions.length) return []

    const counts: Record<string, number> = {}
    for (const s of sessions) {
      const day = (s.started_at ?? s.created_at ?? "").slice(0, 10)
      if (!day || day.length < 10) continue
      counts[day] = (counts[day] ?? 0) + 1
    }

    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }))
  }, [sbProfile])

  // ── Chart data: Sessions by scenario (donut) ──────────────────────────────
  const sessionsByScenario = useMemo(() => {
    const scenarios = sbProfile?.coaching_scenarios ?? []
    return scenarios
      .filter(s => s.session_count > 0)
      .map((s, i) => ({
        name:  s.name,
        value: s.session_count,
        color: brand.chartColors[i % brand.chartColors.length],
      }))
  }, [sbProfile, brand])

  // ── Chart data: Members by role (donut) ───────────────────────────────────
  const membersByRole = useMemo(() => {
    const members = sbProfile?.members ?? []
    const counts: Record<string, number> = {}
    for (const m of members) {
      const role = m.role_name ?? "Unknown"
      counts[role] = (counts[role] ?? 0) + 1
    }
    return Object.entries(counts).map(([name, value], i) => ({
      name,
      value,
      color: brand.chartColors[i % brand.chartColors.length],
    }))
  }, [sbProfile, brand])

  // ── Chart data: Message types (donut) ─────────────────────────────────────
  const messageTypes = useMemo(() => {
    const byType = sbProfile?.message_logs?.by_type ?? {}
    return Object.entries(byType)
      .filter(([, v]) => v > 0)
      .map(([name, value], i) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        color: brand.chartColors[i % brand.chartColors.length],
      }))
  }, [sbProfile, brand])

  // ── Table data ────────────────────────────────────────────────────────────
  const members   = sbProfile?.members   ?? []
  const scenarios = sbProfile?.coaching_scenarios ?? []

  // ── Table columns: Members ────────────────────────────────────────────────
  const memberColumns: Column<SBMember>[] = useMemo(() => [
    {
      key: "full_name",
      header: t.colName,
      render: r => <span className="font-medium">{r.full_name}</span>,
    },
    {
      key: "job_title",
      header: "Job Title",
      render: r => <span className="text-muted-foreground">{r.job_title ?? "—"}</span>,
    },
    {
      key: "role_name",
      header: "Role",
      render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize",
          r.role_name === "Admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {r.role_name ?? "—"}
        </span>
      ),
    },
    {
      key: "whatsapp_number",
      header: "WhatsApp",
      render: r => <span className="tabular-nums text-xs tracking-widest">{maskPhone(r.whatsapp_number)}</span>,
    },
    {
      key: "is_active",
      header: "Status",
      render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.is_active ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
        )}>
          {r.is_active ? t.statusActive : t.statusInactive}
        </span>
      ),
    },
  ], [t])

  // ── Table columns: Scenarios ──────────────────────────────────────────────
  const scenarioColumns: Column<SBScenario>[] = useMemo(() => [
    {
      key: "name",
      header: "Scenario",
      render: r => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "session_count",
      header: t.colSessions,
      render: r => <span className="tabular-nums">{r.session_count}</span>,
    },
    {
      key: "is_active",
      header: "Status",
      render: r => (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        )}>
          {r.is_active ? t.statusActive : t.statusInactive}
        </span>
      ),
    },
    {
      key: "reference_files",
      header: "KB Files",
      render: r => <span className="tabular-nums">{r.reference_files?.length ?? 0}</span>,
    },
  ], [t])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.sbTitle} subtitle={t.sbSub} />
      <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* API warning banner */}
        {sbError && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{t.sbApiUnavailable} — {t.sbApiDbFallback}. ({sbError})</span>
          </div>
        )}

        {/* Source badge */}
        {!sbLoading && (
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded",
              isLive
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            )}>
              {isLive ? `🔗 ${t.sbApiLive}` : `📊 ${t.sbApiDbFallback}`}
            </span>
          </div>
        )}

        {/* ── KPI cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {sbLoading
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
              ? kpis.map((kpi, i) => (
                  <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={sbIcons[i]} />
                ))
              : Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="h-[3px] bg-primary" />
                    <div className="p-5 text-center text-sm text-muted-foreground py-8">{t.noDataAvailable}</div>
                  </div>
                ))
          }
        </div>

        {/* ── Sessions per Day line chart ───────────────────────────────── */}
        <ChartCard
          title={t.sbSessionsPerDay}
          subtitle={t.sbSessionsPerDaySub}
        >
          {sbLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : sessionsPerDay.length > 0
              ? <ActivityLineChart
                  data={sessionsPerDay}
                  label={t.sbCoachingSessions}
                  color={brand.chartColors[0]}
                />
              : <EmptyState />
          }
        </ChartCard>

        {/* ── Donut row: Sessions by Scenario + Members by Role ─────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <ChartCard
            title={t.sbSessionsByScenario}
            subtitle={t.sbSessionsByScenarioSub}
          >
            {sbLoading
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : sessionsByScenario.length > 0
                ? <DonutChart data={sessionsByScenario} />
                : <EmptyState />
            }
          </ChartCard>

          <ChartCard
            title={t.sbMembersByRole}
            subtitle={t.sbMembersByRoleSub}
          >
            {sbLoading
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : membersByRole.length > 0
                ? <DonutChart data={membersByRole} />
                : <EmptyState />
            }
          </ChartCard>
        </div>

        {/* ── Message types donut ──────────────────────────────────────── */}
        {(isLive || sbLoading) && (
          <ChartCard
            title={t.sbMessageTypes}
            subtitle={t.sbMessageTypesSub}
          >
            {sbLoading
              ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
              : messageTypes.length > 0
                ? <DonutChart data={messageTypes} />
                : <EmptyState />
            }
          </ChartCard>
        )}

        {/* ── Members table ─────────────────────────────────────────────── */}
        {(isLive || sbLoading) && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  {t.sbMembers}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sbLoading ? t.loading : `${members.length} ${t.sbMembersCount}`}
                  <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    {t.sbApiLive}
                  </span>
                </p>
              </div>
              <ExportButton
                data={members}
                filename={csvFilename("second-brain-members")}
                columns={[
                  { header: "Name",      value: r => r.full_name },
                  { header: "Job Title", value: r => r.job_title },
                  { header: "Role",      value: r => r.role_name },
                  { header: "WhatsApp",  value: r => maskPhone(r.whatsapp_number) },
                  { header: "Active",    value: r => r.is_active ? "Yes" : "No" },
                  { header: "Created",   value: r => r.created_at?.slice(0, 10) },
                ]}
              />
            </div>
            {sbLoading
              ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
              : members.length > 0
                ? <DataTable data={members} columns={memberColumns} pageSize={10} />
                : <div className="py-10 text-center text-sm text-muted-foreground">{t.sbNoMembers}</div>
            }
          </div>
        )}

        {/* ── Scenarios table ───────────────────────────────────────────── */}
        {(isLive || sbLoading) && (
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Play className="w-4 h-4 text-primary" />
                  {t.sbCoachingScenarios}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sbLoading ? t.loading : `${scenarios.length} ${t.sbScenariosCount}`}
                  <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                    {t.sbApiLive}
                  </span>
                </p>
              </div>
              <ExportButton
                data={scenarios}
                filename={csvFilename("second-brain-scenarios")}
                columns={[
                  { header: "Scenario", value: r => r.name },
                  { header: "Sessions", value: r => r.session_count },
                  { header: "Active",   value: r => r.is_active ? "Yes" : "No" },
                  { header: "KB Files", value: r => r.reference_files?.length ?? 0 },
                  { header: "Created",  value: r => r.created_at?.slice(0, 10) },
                ]}
              />
            </div>
            {sbLoading
              ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
              : scenarios.length > 0
                ? <DataTable data={scenarios} columns={scenarioColumns} pageSize={10} />
                : <div className="py-10 text-center text-sm text-muted-foreground">{t.sbNoScenarios}</div>
            }
          </div>
        )}

      </div>
    </div>
  )
}
