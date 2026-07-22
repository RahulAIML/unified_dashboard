"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp, MessageSquare, Lightbulb, Users, Target } from "lucide-react"
import { DashboardHeader } from "@/components/DashboardHeader"
import { useApi, buildApiUrl } from "@/lib/hooks/useApi"
import { useDashboardStore } from "@/lib/store"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { cn } from "@/lib/utils"
import type { ObjectionsApiResponse, ObjectionRow } from "@/lib/types"

// Minimal capability shape from /api/auth/access-status (only the flag we need).
interface AccessCaps { hasPharmaAccess?: boolean }

/** Success-rate pill colour — worst rates in red, strong ones in emerald. */
function rateColor(pct: number): string {
  if (pct >= 70) return "text-emerald-600 dark:text-emerald-400"
  if (pct >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

function ObjectionCard({ row }: { row: ObjectionRow }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const pct = Math.round(row.passRate)

  return (
    <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-4 sm:px-5 py-4 flex items-center gap-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{row.objectionText}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {row.count} {t.convTimes}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-24 hidden sm:block">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn("h-full rounded-full", pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500")}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
          </div>
          <span className={cn("text-sm font-bold tabular-nums w-12 text-right", rateColor(pct))}>{pct}%</span>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 border-t border-border/60 pt-4 space-y-4">
          {row.modelAnswer && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5 mb-1.5">
                <Lightbulb className="w-3.5 h-3.5" /> {t.convModelAnswer}
              </p>
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{row.modelAnswer}</p>
            </div>
          )}

          {row.topAnswers.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5 mb-2">
                <Users className="w-3.5 h-3.5" /> {t.convAdvisorAnswers}
              </p>
              <div className="space-y-3">
                {row.topAnswers.map((a, i) => (
                  <div key={i} className="border-l-2 border-border pl-3">
                    <p className="text-xs font-semibold text-foreground">{a.name}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap mt-0.5">{a.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ConversationalPage() {
  const { dateRange, refreshKey } = useDashboardStore()
  const t = useT()
  const { user } = useAuthContext()

  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)
  const ready = access?.hasPharmaAccess === true

  const url = ready
    ? buildApiUrl("/api/dashboard/objections", dateRange.from, dateRange.to, { rk: refreshKey })
    : null
  const { data, loading } = useApi<ObjectionsApiResponse>(url)

  // Worst success rate first — the objections advisors struggle with most.
  const rows = useMemo(
    () => [...(data?.data ?? [])].sort((a, b) => a.passRate - b.passRate),
    [data]
  )

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title={t.convTitle} subtitle={t.convSub} showModuleFilter={false} />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-4 max-w-[1200px] mx-auto">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-[16px] bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <MessageSquare className="w-10 h-10 opacity-25 mb-3" />
            <p className="text-sm">{t.noDataAvailable}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Target className="w-4 h-4 text-primary" />
              {t.convWorstFirst}
            </div>
            {rows.map((row, i) => (
              <ObjectionCard key={`${row.usecaseId}-${i}`} row={row} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
