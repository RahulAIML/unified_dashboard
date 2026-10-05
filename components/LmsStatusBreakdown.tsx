"use client"

/**
 * Extracted from app/lms/page.tsx so it's directly unit-testable -- a Next.js
 * App Router page.tsx file may only export a fixed set of names (default,
 * metadata, generateStaticParams, ...), so `export`ing a sub-component
 * straight from a page file fails Next's own generated route-type check.
 */

import { BarChart2 } from "lucide-react"
import { useT } from "@/lib/lang-store"
import { cn } from "@/lib/utils"
import type { LmsApiResponse } from "@/lib/types"

function EmptyState() {
  const t = useT()
  return (
    <div className="h-48 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
      <BarChart2 className="w-8 h-8 opacity-30" />
      <span>{t.noDataAvailable}</span>
    </div>
  )
}

/** Stacked proportion bar over the three enrollment statuses.
 *
 * Denominator is totalUsers * totalCourses (the full roster's possible
 * completions), not totalEnrollments -- matching the same fix already
 * applied to the aggregate/per-course completion rate (see
 * lib/lms-learnworlds.ts's lmsDashboard). A manager reading e.g. 64.8%
 * against enrollments alone would overstate how much of the actual
 * workforce is done, since most of the roster may not have enrolled yet. */
export function LmsStatusBreakdown({ data }: { data: LmsApiResponse }) {
  const t = useT()
  const total = data.totalUsers * data.totalCourses
  if (total === 0) return <EmptyState />

  const rows = [
    { key: "done", label: t.lmsStatusCompleted,  value: data.modulesCompleted, cls: "bg-primary",     text: "text-primary" },
    { key: "wip",  label: t.lmsStatusInProgress, value: data.inProgress,       cls: "bg-amber-500",   text: "text-amber-600" },
    { key: "new",  label: t.lmsStatusNotStarted, value: data.notStarted,       cls: "bg-muted-foreground/40", text: "text-muted-foreground" },
  ]

  return (
    <div className="space-y-4 py-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        {rows.map(r => r.value > 0 && (
          <div key={r.key} className={r.cls} style={{ width: `${(r.value / total) * 100}%` }} />
        ))}
      </div>
      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2">
              <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", r.cls)} />
              <span className="text-muted-foreground">{r.label}</span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className={cn("tabular-nums font-semibold", r.text)}>{r.value.toLocaleString()}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                {Math.round((r.value / total) * 1000) / 10}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
