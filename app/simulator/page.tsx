"use client"
import { brand } from "@/lib/brand"

import { useMemo } from "react"
import { Gamepad2, Users, PlayCircle, Award } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getSimulatorData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDelta } from "@/lib/utils"
import { getSolutionData } from "@/lib/solution-data"
import type {
  TrendsApiResponse,
  UsecaseBreakdownApiResponse,
  UsecaseApiRow,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const icons = [
  <Gamepad2   key="g" className="w-4 h-4" />,
  <Users      key="u" className="w-4 h-4" />,
  <PlayCircle key="p" className="w-4 h-4" />,
  <Award      key="a" className="w-4 h-4" />,
]

export default function SimulatorPage() {
  const { dateRange } = useDashboardStore()
  const t = useT()

  const mockData = getSimulatorData(dateRange)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  const d = getSolutionData("simulator", days)

  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to) + "&solution=simulator"
  const { data: trends, loading: trendsLoading } = useApi<TrendsApiResponse>(trendsUrl)

  const ucUrl = buildApiUrl("/api/dashboard/usecase-breakdown", dateRange.from, dateRange.to) + "&solution=simulator"
  const { data: ucBreakdown, loading: ucLoading } = useApi<UsecaseBreakdownApiResponse>(ucUrl)

  const kpis = useMemo(() => [
    { label: 'Configured Scenarios', labelKey: 'configuredScenarios' as const, value: 3,            delta: 0,                                                            tier: 'B' as const },
    { label: 'Assigned Users',       labelKey: 'assignedUsers'       as const, value: d.users,      delta: calcDelta(d.users, Math.round(d.users * 0.93)),               tier: 'A' as const },
    { label: 'Total Sessions',       labelKey: 'totalSessions'       as const, value: d.totalEvaluations,  delta: calcDelta(d.totalEvaluations, d.prevTotalEvaluations), tier: 'B' as const },
    { label: 'Avg Score',            labelKey: 'avgScore'            as const, value: d.avgScore,   delta: calcDelta(d.avgScore, d.prevAvgScore), unit: 'pts',           tier: 'B' as const },
  ], [d])

  const scoreTrendData = useMemo(
    () => trends?.scoreTrend?.length ? trends.scoreTrend : mockData.scoreTrend,
    [trends, mockData.scoreTrend]
  )

  // ── Usecase breakdown table columns ──────────────────────────────────────
  const ucColumns: Column<UsecaseApiRow>[] = useMemo(() => [
    {
      key: "usecaseId",
      header: t.colScenario,
      render: r => <span className="font-medium">UC-{r.usecaseId}</span>,
    },
    {
      key: "totalEvaluations",
      header: t.colSessions,
      render: r => <span className="tabular-nums">{r.totalEvaluations}</span>,
    },
    {
      key: "avgScore",
      header: t.colAvgScore,
      render: r => r.avgScore != null
        ? <span className="tabular-nums">{r.avgScore} pts</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "passRate",
      header: t.colPassRate,
      render: r => r.passRate != null ? (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.passRate >= 70 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : r.passRate >= 50 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
        )}>
          {r.passRate}%
        </span>
      ) : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "passed",
      header: t.colPassed,
      render: r => <span className="tabular-nums">{r.passed}</span>,
    },
  ], [t])

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.simTitle} subtitle={t.simSub} />
      <div className="p-6 space-y-6">

        {/* KPI cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent={[
                "from-primary/10 to-primary/5",
                "from-primary/10 to-primary/5",
                "from-primary/10 to-primary/5",
                "from-primary/10 to-primary/5",
              ][i]}
            />
          ))}
        </div>

        {/* Score trend */}
        <ChartCard
          title={t.scoreTrend}
          subtitle={`${t.scoreTrendSub} — ${t.last} ${days} ${t.days}`}
        >
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : <ActivityLineChart data={scoreTrendData} label="Avg Score" color={brand.chartColors[0]} />
          }
        </ChartCard>

        {/* Usecase breakdown table */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.usecaseBreakdown}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ucLoading
                ? t.loading
                : `${ucBreakdown?.data?.length ?? 0} ${t.usecaseBreakdownSub}`
              }
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {t.sourceSim}
              </span>
            </p>
          </div>
          {ucLoading
            ? <div className="py-10 text-center text-sm text-muted-foreground">{t.loading}</div>
            : ucBreakdown?.data?.length
              ? <DataTable data={ucBreakdown.data} columns={ucColumns} pageSize={8} />
              : <div className="py-10 text-center text-sm text-muted-foreground">{t.noData}</div>
          }
        </div>

      </div>
    </div>
  )
}
