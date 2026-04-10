"use client"

import { Gamepad2, Users, PlayCircle, Award } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getSimulatorData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import type { ScenarioRow } from "@/lib/types"
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
  const data = getSimulatorData(dateRange)
  const kpis = Object.values(data.kpis)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  const columns: Column<ScenarioRow>[] = [
    { key: "name",         header: t.colScenario,  render: r => <span className="font-medium">{r.name}</span> },
    { key: "assignedUsers",header: t.colUsers,     render: r => <span className="tabular-nums">{r.assignedUsers}</span> },
    { key: "sessions",     header: t.colSessions,  render: r => <span className="tabular-nums">{r.sessions}</span> },
    {
      key: "avgScore", header: t.colAvgScore,
      render: r => r.avgScore != null
        ? <span className="tabular-nums">{r.avgScore} pts</span>
        : <span className="text-muted-foreground">—</span>
    },
    {
      key: "passRate", header: t.colPassRate,
      render: r => r.passRate != null ? (
        <span className={cn(
          "inline-flex px-2 py-0.5 rounded-full text-xs font-medium",
          r.passRate >= 70 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : r.passRate >= 50 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
        )}>
          {r.passRate}%
        </span>
      ) : <span className="text-muted-foreground">—</span>
    },
    { key: "lastActivity", header: t.colLastActive, render: r => <span className="text-muted-foreground text-xs">{r.lastActivity ?? "—"}</span> },
  ]

  return (
    <div className="min-h-screen">
      <DashboardHeader title={t.simTitle} subtitle={t.simSub} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent={["from-emerald-500/10 to-emerald-500/5","from-blue-500/10 to-blue-500/5",
                       "from-violet-500/10 to-violet-500/5","from-amber-500/10 to-amber-500/5"][i]}
            />
          ))}
        </div>
        <ChartCard title={t.scoreTrend} subtitle={`${t.scoreTrendSub} — ${t.last} ${days} ${t.days}`}>
          <ActivityLineChart data={data.scoreTrend} label="Avg Score" color="#10b981" />
        </ChartCard>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">{t.scenarioBreakdown}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t.scenarioBreakdownSub} {days} {t.days}
              <span className="ml-2 text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded">
                {t.sourceSim}
              </span>
            </p>
          </div>
          <DataTable data={data.scenarioTable} columns={columns} pageSize={8} />
        </div>
      </div>
    </div>
  )
}
