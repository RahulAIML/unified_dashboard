"use client"

import { BadgeCheck, TrendingUp, Award, Clock } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { StackedBarChart } from "@/components/charts/StackedBarChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getCertificationData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import type { CertResultRow } from "@/lib/types"
import { cn } from "@/lib/utils"

const icons = [
  <BadgeCheck key="b" className="w-4 h-4" />,
  <TrendingUp key="t" className="w-4 h-4" />,
  <Award      key="a" className="w-4 h-4" />,
  <Clock      key="c" className="w-4 h-4" />,
]

const columns: Column<CertResultRow>[] = [
  { key: "userName", header: "Candidate", render: r => <span className="font-medium">{r.userName}</span> },
  { key: "segment",  header: "Segment",   render: r => <span className="text-muted-foreground">{r.segment}</span> },
  { key: "score",    header: "Score",     render: r => <span className="tabular-nums font-semibold">{r.score} pts</span> },
  {
    key: "passed", header: "Result",
    render: r => (
      <span className={cn(
        "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
        r.passed
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
      )}>
        {r.passed ? "PASS" : "FAIL"}
      </span>
    )
  },
  { key: "date", header: "Date", render: r => <span className="text-muted-foreground text-xs">{r.date}</span> },
]

export default function CertificationPage() {
  const { dateRange } = useDashboardStore()
  const data = getCertificationData(dateRange)
  const kpis = Object.values(data.kpis)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  return (
    <div className="min-h-screen">
      <DashboardHeader title="Expert Certification" subtitle="Evaluation results, pass rates, and score distributions" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent={["from-amber-500/10 to-amber-500/5","from-emerald-500/10 to-emerald-500/5",
                       "from-blue-500/10 to-blue-500/5","from-rose-500/10 to-rose-500/5"][i]}
            />
          ))}
        </div>
        <ChartCard title="Pass / Fail Over Time" subtitle={`Daily evaluations — last ${days} days · source: saved_reports (eval_session_id, passed_flag)`}>
          <StackedBarChart data={data.passFail} />
        </ChartCard>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Evaluation Results</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.resultsTable.length} evaluations in the last {days} days
              <span className="ml-2 text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
                Source: saved_reports + coach_evaluation_sessions + segment_contents
              </span>
            </p>
          </div>
          <DataTable data={data.resultsTable} columns={columns} pageSize={10} />
        </div>
      </div>
    </div>
  )
}
