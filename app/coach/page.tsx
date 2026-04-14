"use client"
import { brand } from "@/lib/brand"

import { BrainCircuit, Users, Layers, GitBranch } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getCoachData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import type { CoachUsecaseRow } from "@/lib/types"

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
  const kpis = Object.values(data.kpis)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

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
        <ChartCard title={t.useCaseDeployment} subtitle={`${t.useCaseDeploymentSub} — ${t.last} ${days} ${t.days}`}>
          <ActivityLineChart data={data.deploymentTrend} label="Use Cases" color={brand.chartColors[0]} />
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
          <DataTable data={data.usecaseTable} columns={columns} pageSize={8} />
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
          <strong>{t.phase2Note}:</strong> {t.phase2Coach}
        </div>
      </div>
    </div>
  )
}


