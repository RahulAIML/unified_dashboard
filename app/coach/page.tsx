"use client"

import { BrainCircuit, Users, Layers, GitBranch } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getCoachData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import type { CoachUsecaseRow } from "@/lib/types"

const icons = [
  <BrainCircuit key="b" className="w-4 h-4" />,
  <Users        key="u" className="w-4 h-4" />,
  <Layers       key="l" className="w-4 h-4" />,
  <GitBranch    key="g" className="w-4 h-4" />,
]

const columns: Column<CoachUsecaseRow>[] = [
  { key: "name",          header: "Use Case", render: r => <span className="font-medium">{r.name}</span> },
  { key: "assignedUsers", header: "Users",    render: r => <span className="tabular-nums">{r.assignedUsers}</span> },
  { key: "stages",        header: "Stages",   render: r => <span className="tabular-nums">{r.stages}</span> },
  {
    key: "interactionType", header: "Mode",
    render: r => (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400">
        {r.interactionType}
      </span>
    )
  },
  { key: "dateCreated", header: "Created", render: r => <span className="text-muted-foreground text-xs">{r.dateCreated}</span> },
]

export default function CoachPage() {
  const { dateRange } = useDashboardStore()
  const data = getCoachData(dateRange)
  const kpis = Object.values(data.kpis)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  return (
    <div className="min-h-screen">
      <DashboardHeader title="Master Coach" subtitle="Use case configurations and user assignments" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent={["from-violet-500/10 to-violet-500/5","from-blue-500/10 to-blue-500/5",
                       "from-emerald-500/10 to-emerald-500/5","from-amber-500/10 to-amber-500/5"][i]}
            />
          ))}
        </div>
        <ChartCard title="Use Case Deployment Over Time" subtitle={`Cumulative use cases configured — last ${days} days`}>
          <ActivityLineChart data={data.deploymentTrend} label="Use Cases" color="#8b5cf6" />
        </ChartCard>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Use Case Inventory</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              All configured coach use cases with assignment details
              <span className="ml-2 text-[10px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded">
                Source: coach_usecases + coach_usecase_user
              </span>
            </p>
          </div>
          <DataTable data={data.usecaseTable} columns={columns} pageSize={8} />
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
          <strong>Phase 2 note:</strong> Activity metrics (sessions started, questions asked, topics queried)
          require activity tracking infrastructure and a privacy policy update. Deferred to Phase 2.
        </div>
      </div>
    </div>
  )
}
