"use client"

import { Users, Target, PlayCircle, Award, TrendingUp, BadgeCheck } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { ModuleBarChart } from "@/components/charts/ModuleBarChart"
import { DonutChart } from "@/components/charts/DonutChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getGlobalOverviewData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import type { UserRow } from "@/lib/types"
import { cn } from "@/lib/utils"

const kpiIcons = [
  <Users key="u" className="w-4 h-4" />,
  <Target key="t" className="w-4 h-4" />,
  <PlayCircle key="p" className="w-4 h-4" />,
  <Award key="a" className="w-4 h-4" />,
  <TrendingUp key="tr" className="w-4 h-4" />,
  <BadgeCheck key="b" className="w-4 h-4" />,
]

const kpiAccents = [
  "from-blue-500/10 to-blue-500/5",
  "from-violet-500/10 to-violet-500/5",
  "from-emerald-500/10 to-emerald-500/5",
  "from-amber-500/10 to-amber-500/5",
  "from-pink-500/10 to-pink-500/5",
  "from-teal-500/10 to-teal-500/5",
]

const DONUT_COLORS: Record<string, string> = {
  "Master Coach":    "#6366f1",
  "Simulator":       "#10b981",
  "Certification":   "#f59e0b",
  "Second Brain":    "#ec4899",
  "LMS":             "#3b82f6",
}

const userColumns: Column<UserRow>[] = [
  { key: "name",             header: "User",      render: r => <span className="font-medium">{r.name}</span> },
  { key: "assignedUsecases", header: "Scenarios", render: r => <span className="tabular-nums">{r.assignedUsecases}</span> },
  { key: "sessions",         header: "Sessions",  render: r => <span className="tabular-nums">{r.sessions}</span> },
  {
    key: "avgScore", header: "Avg Score",
    render: r => r.avgScore != null
      ? <span className="tabular-nums">{r.avgScore} pts</span>
      : <span className="text-muted-foreground">—</span>
  },
  {
    key: "passRate", header: "Pass Rate",
    render: r => r.passRate != null ? (
      <span className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        r.passRate >= 70 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : r.passRate >= 50 ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
      )}>
        {r.passRate}%
      </span>
    ) : <span className="text-muted-foreground">—</span>
  },
  { key: "dateAdded", header: "Joined", render: r => <span className="text-muted-foreground text-xs">{r.dateAdded}</span> },
]

export default function OverviewPage() {
  const { dateRange } = useDashboardStore()
  const data       = getGlobalOverviewData(dateRange)
  const kpiEntries = Object.values(data.kpis)
  const days       = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  // donut data derived from live module breakdown — updates with date range
  const donutData = data.moduleBreakdown
    .filter(m => m.sessions > 0)
    .map(m => ({ name: m.module, value: m.sessions, color: DONUT_COLORS[m.module] ?? "#94a3b8" }))

  return (
    <div className="min-h-screen">
      <DashboardHeader
        title="Global Overview"
        subtitle="Platform-wide analytics across all solutions"
        showModuleFilter
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpiEntries.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={kpiIcons[i]} accent={kpiAccents[i]} />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartCard title="Activity Trend" subtitle={`Daily sessions — last ${days} days`} className="lg:col-span-2">
            <ActivityLineChart data={data.activityTrend} label="Sessions" />
          </ChartCard>
          <ChartCard title="Module Distribution" subtitle={`Sessions by solution — ${days}d`}>
            <DonutChart data={donutData} />
          </ChartCard>
        </div>

        <ChartCard title="Sessions by Module" subtitle={`Total vs passed — last ${days} days`}>
          <ModuleBarChart data={data.moduleBreakdown} />
        </ChartCard>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">User Summary</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Session activity for the last {days} days
              <span className="ml-2 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">
                Source: coach_users + saved_reports
              </span>
            </p>
          </div>
          <DataTable data={data.userTable} columns={userColumns} pageSize={8} />
        </div>
      </div>
    </div>
  )
}
