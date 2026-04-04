"use client"

import { Database, FileType, Layers, BarChart2 } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { ChartCard } from "@/components/ChartCard"
import { ActivityLineChart } from "@/components/charts/ActivityLineChart"
import { DataTable, type Column } from "@/components/DataTable"
import { getSecondBrainData } from "@/lib/mock-data"
import { useDashboardStore } from "@/lib/store"
import type { DocRow } from "@/lib/types"

const TYPE_COLORS: Record<string, string> = {
  pdf:  "bg-red-500/15 text-red-600 dark:text-red-400",
  docx: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  pptx: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  xlsx: "bg-green-500/15 text-green-600 dark:text-green-400",
  txt:  "bg-gray-500/15 text-gray-600 dark:text-gray-400",
  mp4:  "bg-purple-500/15 text-purple-600 dark:text-purple-400",
}

const icons = [
  <Database  key="d" className="w-4 h-4" />,
  <FileType  key="f" className="w-4 h-4" />,
  <Layers    key="l" className="w-4 h-4" />,
  <BarChart2 key="b" className="w-4 h-4" />,
]

const columns: Column<DocRow>[] = [
  { key: "name",         header: "Document",   render: r => <span className="font-medium font-mono text-xs">{r.name}</span> },
  {
    key: "type", header: "Type",
    render: r => (
      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold uppercase ${TYPE_COLORS[r.type] ?? "bg-muted"}`}>
        {r.type}
      </span>
    )
  },
  { key: "usecaseName",  header: "Use Case",  render: r => <span className="text-muted-foreground">{r.usecaseName}</span> },
  { key: "segmentCount", header: "Segments",  render: r => <span className="tabular-nums">{r.segmentCount}</span> },
  { key: "dateAdded",    header: "Date Added",render: r => <span className="text-muted-foreground text-xs">{r.dateAdded}</span> },
]

export default function SecondBrainPage() {
  const { dateRange } = useDashboardStore()
  const data = getSecondBrainData(dateRange)
  const kpis = Object.values(data.kpis)
  const days = Math.round((dateRange.to.getTime() - dateRange.from.getTime()) / 86_400_000)

  return (
    <div className="min-h-screen">
      <DashboardHeader title="Second Brain" subtitle="Knowledge base content inventory and document tracking" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent={["from-pink-500/10 to-pink-500/5","from-blue-500/10 to-blue-500/5",
                       "from-violet-500/10 to-violet-500/5","from-teal-500/10 to-teal-500/5"][i]}
            />
          ))}
        </div>
        <ChartCard title="Document Uploads Over Time" subtitle={`New docs added — last ${days} days · source: segment_contents.date_created`}>
          <ActivityLineChart data={data.uploadTrend} label="Documents" color="#ec4899" />
        </ChartCard>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Document Inventory</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.docTable.length} documents {days < 90 ? `added in the last ${days} days` : "in total"}
              <span className="ml-2 text-[10px] font-medium bg-pink-500/10 text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded">
                Source: segment_contents + usecase_segment + coach_usecases
              </span>
            </p>
          </div>
          <DataTable data={data.docTable} columns={columns} pageSize={10} />
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
          <strong>Phase 2 note:</strong> Query analytics (total queries, top topics, satisfaction scores)
          require activity tracking infrastructure. Deferred to Phase 2.
        </div>
      </div>
    </div>
  )
}
