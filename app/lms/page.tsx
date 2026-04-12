"use client"

import { BookOpen, Users, CheckCircle, Star } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { SummaryCard } from "@/components/SummaryCard"
import { EmptyState } from "@/components/EmptyState"
import { useT } from "@/lib/lang-store"

const kpis = [
  { label: "Enrolled Users",    labelKey: "enrolledUsers"    as const, value: "—", delta: 0, tier: "B" as const },
  { label: "Completion Rate",   labelKey: "completionRate"   as const, value: "—", delta: 0, unit: "%", tier: "B" as const },
  { label: "Avg Quiz Score",    labelKey: "avgQuizScore"     as const, value: "—", delta: 0, unit: "pts", tier: "B" as const },
  { label: "Modules Completed", labelKey: "modulesCompleted" as const, value: "—", delta: 0, tier: "B" as const },
]

const icons = [
  <Users       key="u" className="w-4 h-4" />,
  <CheckCircle key="c" className="w-4 h-4" />,
  <Star        key="s" className="w-4 h-4" />,
  <BookOpen    key="b" className="w-4 h-4" />,
]

export default function LmsPage() {
  const t = useT()
  return (
    <div className="min-h-screen">
      <DashboardHeader
        title={t.lmsTitle}
        subtitle={t.lmsSub}
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {kpis.map((kpi, i) => (
            <SummaryCard key={kpi.label} kpi={kpi} index={i} icon={icons[i]}
              accent="from-primary/10 to-primary/5"
            />
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <EmptyState
            title={t.lmsNoData}
            message={t.lmsNoDataSub}
            icon={<BookOpen className="w-6 h-6 text-muted-foreground" />}
          />
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-primary">
          <strong>{t.lmsAuditNeeded}:</strong> {t.lmsNoDataSub}
        </div>
      </div>
    </div>
  )
}

