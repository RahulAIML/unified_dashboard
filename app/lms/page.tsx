"use client"

import { BookOpen, Users, CheckCircle, Star } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { EmptyState } from "@/components/EmptyState"

const kpis = [
  { label: "Enrolled Users",    value: "—", delta: 0, tier: "B" as const },
  { label: "Completion Rate",   value: "—", delta: 0, unit: "%", tier: "B" as const },
  { label: "Avg Quiz Score",    value: "—", delta: 0, unit: "pts", tier: "B" as const },
  { label: "Modules Completed", value: "—", delta: 0, tier: "B" as const },
]

const icons = [
  <Users       key="u" className="w-4 h-4" />,
  <CheckCircle key="c" className="w-4 h-4" />,
  <Star        key="s" className="w-4 h-4" />,
  <BookOpen    key="b" className="w-4 h-4" />,
]

export default function LmsPage() {
  return (
    <div className="min-h-screen">
      <DashboardHeader
        title="LMS"
        subtitle="Learning module enrollments, completions, and quiz scores"
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent="from-blue-500/10 to-blue-500/5"
            />
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <EmptyState
            title="LMS data not yet connected"
            message="LMS data lives in the rolplay.pro database. This view will be populated once the backend API endpoint is built to query that schema. All metrics are Tier B (backend aggregation required)."
            icon={<BookOpen className="w-6 h-6 text-muted-foreground" />}
          />
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm text-blue-700 dark:text-blue-400">
          <strong>Database note:</strong> LMS tables (module assignments, completion records, quiz scores)
          appear to reside in the <code className="text-xs bg-blue-500/10 px-1 rounded">rolplay.pro</code> database,
          not the <code className="text-xs bg-blue-500/10 px-1 rounded">coach_app</code> schema audited for this build.
          Week 1 audit action: confirm schema + connect API endpoint.
        </div>
      </div>
    </div>
  )
}
