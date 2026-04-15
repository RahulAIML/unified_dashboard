"use client"

import { useMemo } from "react"
import { BrainCircuit, Users, PlayCircle, TrendingUp } from "lucide-react"
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
import { brand } from "@/lib/brand"
import { getSolutionData } from "@/lib/solution-data"
import type { CoachUsecaseRow } from "@/lib/types"

const icons = [
  <BrainCircuit key="b" className="w-4 h-4" />,
  <Users        key="u" className="w-4 h-4" />,
  <PlayCircle   key="p" className="w-4 h-4" />,
  <TrendingUp   key="t" className="w-4 h-4" />,
]

export default function CoachPage() {
  const { dateRange } = useDashboardStore()
  const t = useT()
  const mockData = getCoachData(dateRange)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  const d = getSolutionData("coach", days)

  const trendsUrl = buildApiUrl("/api/dashboard/trends", dateRange.from, dateRange.to) + "&solution=coach"
  const { data: trends, loading: trendsLoading } = useApi<any>(trendsUrl)

  const kpis = useMemo(() => [
    {
      label: "Configured Use Cases", labelKey: "configuredUseCases" as const,
      value: 3,  // 3 coach usecases: 369, 381, 385
      delta: 0, tier: "B" as const,
    },
    {
      label: "Assigned Users", labelKey: "assignedUsers" as const,
      value: d.users,
      delta: calcDelta(d.users, Math.round(d.users * 0.91)),
      tier: "A" as const,
    },
    {
      label: "Practice Sessions", labelKey: "practiceSessions" as const,
      value: d.totalEvaluations,
      delta: calcDelta(d.totalEvaluations, d.prevTotalEvaluations),
      tier: "A" as const,
    },
    {
      label: "Avg Score", labelKey: "avgScore" as const,
      value: d.avgScore, unit: "pts",
      delta: calcDelta(d.avgScore, d.prevAvgScore),
      tier: "B" as const,
    },
  ], [d])

  const activityData = useMemo(
    () => trends?.evalCountTrend?.length ? trends.evalCountTrend : [],
    [trends]
  )

  const columns: Column<CoachUsecaseRow>[] = [
    { key: "name",            header: t.colUseCase,  render: r => <span className="font-medium">{r.name}</span> },
    { key: "assignedUsers",   header: t.colUsers,    render: r => <span className="tabular-nums">{r.assignedUsers}</span> },
    { key: "stages",          header: t.colStages,   render: r => <span className="tabular-nums">{r.stages}</span> },
    { key: "interactionType", header: t.colMode,     render: r => (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
        {r.interactionType}
      </span>
    )},
    { key: "dateCreated",     header: t.colCreated,  render: r => <span className="text-muted-foreground text-xs">{r.dateCreated}</span> },
  ]

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.coachTitle} subtitle={t.coachSub} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]} />)}
        </div>

        <ChartCard title={t.useCaseDeployment} subtitle={`${t.useCaseDeploymentSub} — ${t.last} ${days} ${t.days}`}>
          {trendsLoading
            ? <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">{t.loading}</div>
            : activityData.length > 0
              ? <ActivityLineChart data={activityData} label="Sessions" color={brand.chartColors[0]} />
              : <ActivityLineChart data={mockData.deploymentTrend} label="Use Cases" color={brand.chartColors[0]} />
          }
        </ChartCard>

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
          <DataTable data={mockData.usecaseTable} columns={columns} pageSize={8} />
        </div>
      </div>
    </div>
  )
}
