"use client"

import { useEffect, useState, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, BarChart2, BadgeCheck, XCircle, Hash, CalendarDays, Layers } from "lucide-react"
import { useClientBrand }                      from "@/lib/hooks/useClientBrand"
import { normalizeScore }                       from "@/lib/kpi-builder"
import { CORE_FIELD_KEYS, EXTRA_FIELD_KEYS }    from "@/lib/field-map"
import { cn }                                   from "@/lib/utils"

// ── Types (mirrors DrilldownResult from data-provider) ────────────────────────

interface DrilldownField {
  fieldKey:        string
  fieldLabel:      string | null
  valueNum:        number | null
  valueText:       string | null
  valueLongtext:   string | null
  normalizedValue: number | string | null
}

interface DrilldownData {
  savedReportId: number
  usecaseId:     number | null
  date:          string
  fields:        DrilldownField[]
  closingJson:   Record<string, unknown> | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Use the canonical field sets from field-map — CORE fields only for KPI display

const SCORE_FIELDS  = new Set(["overall_score", "final_score"])   // subset of CORE
const RESULT_FIELDS = new Set(["overall_result", "status"])        // subset of CORE

function resolveDisplay(field: DrilldownField): string {
  const v = field.normalizedValue
  if (v === null || v === undefined) return "—"
  return String(v)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="h-[3px] w-full" style={{ background: color ?? "#DC2626" }} />
      <div className="px-4 py-3 flex items-center gap-3">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">
            {label}
          </p>
          <p className="text-base font-bold tabular-nums truncate">{value}</p>
        </div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-96 rounded-xl bg-muted" />
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-64 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <BarChart2 className="w-10 h-10 opacity-25" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20

export default function DrilldownPage() {
  const params = useParams()
  const router = useRouter()
  const brand  = useClientBrand()
  const id     = params?.id as string | undefined

  const [data,    setData]    = useState<DrilldownData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [page,    setPage]    = useState(0)
  const [search,  setSearch]  = useState("")

  // ── Fetch ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)

    fetch(`/api/dashboard/drilldown/${id}`)
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        return json as DrilldownData
      })
      .then((d) => { setData(d); setLoading(false) })
      .catch((e) => { setError(String(e?.message ?? e)); setLoading(false) })
  }, [id])

  // ── Derived KPIs ──────────────────────────────────────────────────────────
  const scoreField  = data?.fields.find((f) => SCORE_FIELDS.has(f.fieldKey))
  const resultField = data?.fields.find((f) => RESULT_FIELDS.has(f.fieldKey))

  const displayScore = useMemo(() => {
    if (!scoreField) return null
    const raw = scoreField.valueNum
    const norm = normalizeScore(raw)
    return norm !== null ? `${Math.round(norm)} pts` : null
  }, [scoreField])

  const displayResult = resultField?.valueText ?? null
  const passed        = displayResult !== null && displayResult !== "Deficiente"

  // ── Filtered + paginated fields ───────────────────────────────────────────
  const filteredFields = useMemo(() => {
    if (!data) return []
    const q = search.toLowerCase().trim()
    if (!q) return data.fields
    return data.fields.filter(
      (f) =>
        f.fieldKey.toLowerCase().includes(q) ||
        (f.fieldLabel ?? "").toLowerCase().includes(q) ||
        String(f.normalizedValue ?? "").toLowerCase().includes(q)
    )
  }, [data, search])

  const totalPages   = Math.ceil(filteredFields.length / PAGE_SIZE)
  const visibleFields = filteredFields.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset page on search
  useEffect(() => { setPage(0) }, [search])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div
          className="h-[3px] w-full"
          style={{ background: `linear-gradient(90deg, ${brand.primaryColor}, ${brand.accentColor})` }}
        />
        <div className="px-6 py-3 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-sm font-semibold" style={{ color: brand.primaryColor }}>
            Session Detail — Report #{id}
          </h1>
        </div>
      </div>

      <div className="p-6 space-y-6">

        {/* Loading */}
        {loading && <Skeleton />}

        {/* Error */}
        {!loading && error && (
          <EmptyState message={`Failed to load report: ${error}`} />
        )}

        {/* Empty */}
        {!loading && !error && !data && (
          <EmptyState message="Report not found or no data available." />
        )}

        {/* Data */}
        {!loading && !error && data && (
          <>
            {/* Summary chips */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatChip
                icon={<Hash className="w-4 h-4" />}
                label="Report ID"
                value={`#${data.savedReportId}`}
                color={brand.primaryColor}
              />
              <StatChip
                icon={<Layers className="w-4 h-4" />}
                label="Use Case"
                value={data.usecaseId != null ? `UC-${data.usecaseId}` : "—"}
                color={brand.primaryColor}
              />
              <StatChip
                icon={<CalendarDays className="w-4 h-4" />}
                label="Date"
                value={data.date || "—"}
                color={brand.primaryColor}
              />
              {displayScore ? (
                <StatChip
                  icon={<BarChart2 className="w-4 h-4" />}
                  label="Score"
                  value={displayScore}
                  color={brand.primaryColor}
                />
              ) : (
                <StatChip
                  icon={
                    displayResult ? (
                      passed
                        ? <BadgeCheck className="w-4 h-4 text-emerald-500" />
                        : <XCircle   className="w-4 h-4 text-rose-500" />
                    ) : (
                      <BarChart2 className="w-4 h-4" />
                    )
                  }
                  label="Result"
                  value={displayResult ?? "—"}
                  color={brand.primaryColor}
                />
              )}
            </div>

            {/* Result badge (if score is also shown) */}
            {displayScore && displayResult && (
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold",
                    passed
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                  )}
                >
                  {passed
                    ? <BadgeCheck className="w-4 h-4" />
                    : <XCircle   className="w-4 h-4" />
                  }
                  {displayResult}
                </span>
                <span className="text-xs text-muted-foreground">
                  {data.fields.length} fields recorded
                </span>
              </div>
            )}

            {/* Fields table */}
            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
              {/* Table header */}
              <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-sm font-semibold">All Fields</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {filteredFields.length} of {data.fields.length} fields
                    {search && " matching search"}
                  </p>
                </div>
                <input
                  type="search"
                  placeholder="Search fields…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border bg-muted placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
                />
              </div>

              {/* Table */}
              {visibleFields.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  {search ? "No fields match your search." : "No fields recorded for this session."}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-48">
                          Field Key
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-48">
                          Label
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Value
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-24">
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFields.map((field, i) => {
                        const isScore   = SCORE_FIELDS.has(field.fieldKey)
                        const isResult  = RESULT_FIELDS.has(field.fieldKey)
                        const isCore    = CORE_FIELD_KEYS.has(field.fieldKey)
                        const isExtra   = EXTRA_FIELD_KEYS.has(field.fieldKey)
                        const display   = resolveDisplay(field)
                        const valueType =
                          field.valueNum      !== null ? "numeric"
                          : field.valueText   !== null ? "text"
                          : field.valueLongtext !== null ? "longtext"
                          : "—"

                        return (
                          <tr
                            key={field.fieldKey + i}
                            className={cn(
                              "border-b border-border/60 last:border-0 transition-colors",
                              (isScore || isResult) && "bg-primary/5"
                            )}
                          >
                            {/* Field key */}
                            <td className="px-4 py-2.5">
                              <code className="text-xs font-mono text-muted-foreground break-all">
                                {field.fieldKey}
                              </code>
                              {isCore && (
                                <span
                                  className="ml-2 text-[9px] font-bold uppercase px-1 py-0.5 rounded"
                                  style={{ background: brand.primaryColor, color: "#fff" }}
                                >
                                  {isScore ? "score" : "result"}
                                </span>
                              )}
                              {isExtra && (
                                <span className="ml-2 text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-violet-500/15 text-violet-600 dark:text-violet-400">
                                  qualitative
                                </span>
                              )}
                            </td>

                            {/* Label */}
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {field.fieldLabel ?? "—"}
                            </td>

                            {/* Value */}
                            <td className="px-4 py-2.5">
                              {isResult ? (
                                <span
                                  className={cn(
                                    "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
                                    display === "Deficiente"
                                      ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                      : display === "—"
                                      ? "text-muted-foreground"
                                      : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  )}
                                >
                                  {display}
                                </span>
                              ) : isScore ? (
                                <span className="font-semibold tabular-nums">
                                  {field.valueNum !== null
                                    ? `${Math.round(normalizeScore(field.valueNum) ?? 0)} pts (raw: ${field.valueNum})`
                                    : "—"}
                                </span>
                              ) : (
                                <span
                                  className={cn(
                                    "break-words",
                                    display === "—" && "text-muted-foreground"
                                  )}
                                >
                                  {display}
                                </span>
                              )}
                            </td>

                            {/* Type badge */}
                            <td className="px-4 py-2.5">
                              <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                {valueType}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-5 py-3 border-t border-border flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
