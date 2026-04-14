"use client"
import { brand } from "@/lib/brand"

import { useMemo } from "react"
import { BrainCircuit, Users, Layers, GitBranch } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getCoachData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { calcDelta } from "@/lib/utils"
import type {
  OverviewApiResponse,
  TrendsApiResponse,
  CoachUsecaseRow,
} from "@/lib/types"

const icons = [
  <BrainCircuit key="b" className="w-4 h-4" />,
  <Users        key="u" className="w-4 h-4" />,
  <Layers       key="l" className="w-4 h-4" />,
  <GitBranch    key="g" className="w-4 h-4" />,
]

export default function CoachPage() {
  const { dateRange } = useDashboardStore()
  const t = useT()
  const data = getCoachData(dateRange)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  // ── Real API calls ────────────────────────────────────────────────────────
  const overviewUrl = buildApiUrl("/api/dashboard/overview", dateRange.from, dateRange.to) + "&solution=coach"
  const { data: overview, loading: overviewLoading, error: overviewError } =
    useApi<OverviewApiResponse>(overviewUrl)

  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to) + "&solution=coach"
  const { data: trends } = useApi<TrendsApiResponse>(trendsUrl)

  // ── KPI cards: mix fixed + real ───────────────────────────────────────────
  // Slot 0: Configured Use Cases — always 3 (coach usecases 369, 381, 385)
  // Slot 1: Assigned Users — fixed 62 from SOLUTION_MOCK.coach.users
  // Slot 2: Practice Sessions — real API overview.totalEvaluations, fallback 287
  // Slot 3: Avg Score — real API overview.avgScore, fallback 69
  const kpis = useMemo(() => {
    const totalEvaluations = overview?.totalEvaluations ?? 287
    const avgScore = overview?.avgScore ?? 69
    const prevTotal = overview?.prevTotalEvaluations ?? 320
    const prevAvg = overview?.prevAvgScore ?? 72

    return [
      {
        label:    'Configured Use Cases',
        labelKey: 'configuredUseCases' as const,
        value:    3,
        delta:    0,
        tier:     'A' as const,
      },
      {
        label:    'Assigned Users',
        labelKey: 'assignedUsers' as const,
        value:    62,
        delta:    0,
        tier:     'A' as const,
      },
      {
        label:    'Practice Sessions',
        labelKey: 'practiceSessions' as const,
        value:    totalEvaluations,
        delta:    calcDelta(totalEvaluations, prevTotal),
        tier:     'B' as const,
      },
      {
        label:    'Avg Score',
        labelKey: 'avgScore' as const,
        value:    avgScore,
        delta:    calcDelta(avgScore, prevAvg),
        unit:     'pts',
        tier:     'B' as const,
      },
    ]
  }, [overview, overviewLoading])

  // ── Activity trend (real evalCountTrend, fallback empty) ──────────────────
  const activityData = useMemo(
    () => trends?.evalCountTrend?.length ? trends.evalCountTrend : [],
    [trends]
  )

  const columns: Column<CoachUsecaseRow>[] = [
    { key: "name",          header: t.colUseCase, render: r => <span className="font-medium">{r.name}</span> },
    { key: "assignedUsers", header: t.colUsers,   render: r => <span className="tabular-nums">{r.assignedUsers}</span> },
    { key: "stages",        header: t.colStages,  render: r => <span className="tabular-nums">{r.stages}</span> },
    {
      key: "interactionType", header: t.colMode,
      render: r => (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
          {r.interactionType}
        </span>
      )
    },
    { key: "dateCreated", header: t.colCreated, render: r => <span className="text-muted-foreground text-xs">{r.dateCreated}</span> },
  ]

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.coachTitle} subtitle={t.coachSub} />
      <div className="p-6 space-y-6">

        {overviewError && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
            {t.errorLoading}: {overviewError}
          </div>
        )}

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

        {/* Activity trend */}
        <ChartCard title={t.activityTrend} subtitle={`${t.evalCountSub} — ${t.last} ${days} ${t.days}`}>
          <ActivityLineChart data={activityData} label="Evaluations" color={brand.chartColors[0]} />
        </ChartCard>

        {/* Use case inventory table (coach-specific config data) */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.useCaseInventory}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t.useCaseInventorySub}
              <span className="ml-2 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                {t.sourceCoach}
              </span>
            </p>
          </div>
          <DataTable data={data.usecaseTable} columns={columns} pageSize={8} />
        </div>

      </div>
    </div>
  )
}
