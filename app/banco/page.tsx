"use client"

import { useMemo } from "react"
import {
  Building2, Users, UserCheck, TrendingUp,
  MessageSquare, BarChart2, AlertTriangle, Shield,
} from "lucide-react"
import { DashboardHeader }    from "@/components/DashboardHeader"
import { SummaryCard }        from "@/components/SummaryCard"
import { ChartCard }          from "@/components/ChartCard"
import { DonutChart }         from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
import { useApi }             from "@/lib/hooks/useApi"
import { useClientBrand }     from "@/lib/hooks/useClientBrand"
import type { KpiCard }       from "@/lib/types"
import { cn }                 from "@/lib/utils"

// ── Types (from /api/banco) ────────────────────────────────────────────────────

interface BancoKpis {
  totalSessions:       number
  activeBancoUsers:    number
  totalBancoUsers:     number
  directorsCount:      number
  regionalsCount:      number
  avgRoundsPerSession: number
  sessionsByPosition:  { position: string; sessions: number }[]
  topPerformers:       { name: string; position: string; sessions: number; avgRounds: number }[]
  recentSessions: {
    report_id:        number
    banco_user_id:    number
    employee_name:    string
    position:         string
    date_created:     string
    rounds_completed: number
  }[]
  hasData: boolean
}

interface BancoApiResponse {
  success: boolean
  data: {
    source: string
    kpis:   BancoKpis
    period: { from: string; to: string }
  } | null
  meta: { message?: string; timestamp?: string; email?: string }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-[16px] border border-border/60 bg-card p-5 animate-pulse">
      <div className="h-3 w-24 bg-muted rounded mb-3" />
      <div className="h-8 w-16 bg-muted rounded mb-2" />
      <div className="h-3 w-32 bg-muted rounded" />
    </div>
  )
}

function SkeletonChart() {
  return (
    <div className="rounded-[16px] border border-border/60 bg-card p-5 animate-pulse h-64">
      <div className="h-4 w-32 bg-muted rounded mb-3" />
      <div className="h-3 w-48 bg-muted rounded mb-6" />
      <div className="flex gap-3 items-end h-32">
        {[60, 40, 80, 55, 70, 45, 90].map((h, i) => (
          <div key={i} className="flex-1 bg-muted rounded-t" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
        <Building2 className="w-8 h-8 text-muted-foreground" />
      </div>
      <p className="text-lg font-semibold">No data available for selected period</p>
      <p className="text-sm text-muted-foreground max-w-xs">
        No Banco sessions found. Data will appear once sessions are recorded.
      </p>
    </div>
  )
}

// ── Position badge ────────────────────────────────────────────────────────────

function PositionBadge({ position }: { position: string }) {
  const isDirector = position?.toUpperCase() === 'DIRECTOR'
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide",
      isDirector
        ? "bg-primary/10 text-primary"
        : "bg-muted text-muted-foreground"
    )}>
      {isDirector && <Shield className="w-2.5 h-2.5" />}
      {position}
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BancoPage() {
  const brand = useClientBrand()

  const { from, to } = useMemo(() => {
    const now  = new Date()
    const from = new Date(now)
    from.setDate(from.getDate() - 30)
    return { from: from.toISOString(), to: now.toISOString() }
  }, [])

  const { data: apiData, loading, error } = useApi<BancoApiResponse>(
    `/api/banco?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )

  const kpis = apiData?.data?.kpis ?? null

  // ── KPI cards ──────────────────────────────────────────────────────────────

  const kpiCards: Array<{ kpi: KpiCard; icon: React.ReactNode }> = useMemo(() => {
    if (!kpis) return []
    return [
      {
        kpi: {
          label:    'Total Sessions',
          labelKey: 'bancoTotalSessions',
          value:    kpis.totalSessions,
          delta:    0,
          tier:     'A',
        },
        icon: <MessageSquare className="w-4 h-4" />,
      },
      {
        kpi: {
          label:    'Active Employees',
          labelKey: 'bancoActiveEmployees',
          value:    kpis.activeBancoUsers,
          delta:    0,
          unit:     `of ${kpis.totalBancoUsers}`,
          tier:     'A',
        },
        icon: <UserCheck className="w-4 h-4" />,
      },
      {
        kpi: {
          label:    'Avg Rounds / Session',
          labelKey: 'bancoAvgRounds',
          value:    kpis.avgRoundsPerSession,
          delta:    0,
          unit:     'rounds',
          tier:     'B',
        },
        icon: <TrendingUp className="w-4 h-4" />,
      },
      {
        kpi: {
          label:    'Banco Users',
          labelKey: 'bancoTotalUsers',
          value:    kpis.totalBancoUsers,
          delta:    0,
          unit:     `${kpis.directorsCount}D · ${kpis.regionalsCount}R`,
          tier:     'B',
        },
        icon: <Users className="w-4 h-4" />,
      },
    ]
  }, [kpis])

  // ── Donut chart data ────────────────────────────────────────────────────────

  const positionDonut = useMemo(() => {
    if (!kpis?.sessionsByPosition?.length) return []
    return kpis.sessionsByPosition.map((p, i) => ({
      name:  p.position,
      value: p.sessions,
      color: i === 0 ? brand.primaryColor : brand.secondaryColor,
    }))
  }, [kpis, brand])

  // ── Columns: top performers ─────────────────────────────────────────────────

  type Performer = BancoKpis['topPerformers'][number]

  const perfColumns: Column<Performer>[] = [
    {
      key:    'name',
      header: 'Employee',
      render: (r) => <p className="text-sm font-medium truncate max-w-[200px]">{r.name}</p>,
    },
    {
      key:    'position',
      header: 'Position',
      render: (r) => <PositionBadge position={r.position} />,
    },
    {
      key:    'sessions',
      header: 'Sessions',
      render: (r) => (
        <span className="font-semibold tabular-nums text-sm" style={{ color: brand.primaryColor }}>
          {r.sessions}
        </span>
      ),
    },
    {
      key:    'avgRounds',
      header: 'Avg Rounds',
      render: (r) => (
        <span className="text-sm text-muted-foreground tabular-nums">
          {r.avgRounds.toFixed(1)}
        </span>
      ),
    },
  ]

  // ── Columns: recent sessions ────────────────────────────────────────────────

  type RecentSession = BancoKpis['recentSessions'][number]

  const sessionColumns: Column<RecentSession>[] = [
    {
      key:    'employee_name',
      header: 'Employee',
      render: (r) => <p className="text-sm font-medium truncate max-w-[200px]">{r.employee_name}</p>,
    },
    {
      key:    'position',
      header: 'Position',
      render: (r) => <PositionBadge position={r.position} />,
    },
    {
      key:    'rounds_completed',
      header: 'Rounds',
      render: (r) => (
        <span className="text-sm font-semibold tabular-nums" style={{ color: brand.accentColor }}>
          {r.rounds_completed}
        </span>
      ),
    },
    {
      key:    'date_created',
      header: 'Date',
      render: (r) => <span className="text-xs text-muted-foreground">{r.date_created}</span>,
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      <DashboardHeader
        title="Banco Analytics"
        subtitle="Isolated Banco pipeline · Employee coaching performance"
      />

      <div className="px-4 sm:px-6 py-6 space-y-6">

        {/* Error banner */}
        {error && !loading && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 flex items-center gap-3 text-sm text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Unable to load Banco data. The pipeline may be temporarily unavailable.</span>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : kpiCards.map(({ kpi, icon }, i) => (
                <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icon} />
              ))
          }
        </div>

        {/* No data state */}
        {!loading && !error && kpis && !kpis.hasData && <EmptyState />}

        {/* Charts row */}
        {loading && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SkeletonChart />
            <SkeletonChart />
          </div>
        )}

        {!loading && kpis?.hasData && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Sessions by position donut */}
            <ChartCard
              title="Sessions by Position"
              subtitle="Distribution across DIRECTOR and REGIONAL"
            >
              {positionDonut.length > 0
                ? <DonutChart data={positionDonut} />
                : (
                  <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                    No session distribution data
                  </div>
                )
              }
            </ChartCard>

            {/* Hierarchy overview */}
            <ChartCard
              title="Employee Hierarchy"
              subtitle="Banco organizational structure overview"
            >
              <div className="space-y-4 py-2">
                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: `${brand.primaryColor}18` }}
                    >
                      <Shield className="w-4 h-4" style={{ color: brand.primaryColor }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Directors</p>
                      <p className="text-xs text-muted-foreground">Top-level management</p>
                    </div>
                  </div>
                  <p className="text-2xl font-bold" style={{ color: brand.primaryColor }}>
                    {kpis?.directorsCount ?? 0}
                  </p>
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center"
                      style={{ background: `${brand.secondaryColor}18` }}
                    >
                      <Building2 className="w-4 h-4" style={{ color: brand.secondaryColor }} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Regionals</p>
                      <p className="text-xs text-muted-foreground">Report to Directors</p>
                    </div>
                  </div>
                  <p className="text-2xl font-bold" style={{ color: brand.secondaryColor }}>
                    {kpis?.regionalsCount ?? 0}
                  </p>
                </div>

                {kpis && kpis.totalBancoUsers > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Directors {Math.round((kpis.directorsCount / kpis.totalBancoUsers) * 100)}%</span>
                      <span>Regionals {Math.round((kpis.regionalsCount / kpis.totalBancoUsers) * 100)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden flex">
                      <div
                        className="h-full transition-all"
                        style={{
                          width:      `${(kpis.directorsCount / kpis.totalBancoUsers) * 100}%`,
                          background: brand.primaryColor,
                        }}
                      />
                      <div className="h-full flex-1" style={{ background: brand.secondaryColor }} />
                    </div>
                  </div>
                )}
              </div>
            </ChartCard>
          </div>
        )}

        {/* Top performers */}
        {!loading && kpis?.hasData && kpis.topPerformers.length > 0 && (
          <ChartCard
            title="Top Performers"
            subtitle="Banco employees ranked by sessions in the selected period"
          >
            <DataTable
              columns={perfColumns}
              data={kpis.topPerformers}
              emptyMessage="No performer data available"
            />
          </ChartCard>
        )}

        {/* Recent sessions */}
        {!loading && kpis?.hasData && kpis.recentSessions.length > 0 && (
          <ChartCard
            title="Recent Sessions"
            subtitle="Last 20 Banco coaching sessions"
          >
            <DataTable
              columns={sessionColumns}
              data={kpis.recentSessions}
              emptyMessage="No recent sessions"
            />
          </ChartCard>
        )}

        {/* Data source footnote */}
        <p className="text-xs text-muted-foreground/40 text-center py-2">
          Banco isolated pipeline · coach_app.banco_users → saved_reports · Not mixed with analytics DB
        </p>

      </div>
    </div>
  )
}
