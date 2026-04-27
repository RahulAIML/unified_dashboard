"use client"

import { useState, useMemo, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, BarChart2, BadgeCheck, XCircle, Hash, CalendarDays, Layers, Globe } from "lucide-react"
import { useClientBrand }                      from "@/lib/hooks/useClientBrand"
import { useApi }                              from "@/lib/hooks/useApi"
import { useTranslation }                      from "@/lib/hooks/useTranslation"
import { normalizeResult, normalizeScore }       from "@/lib/kpi-builder"
import { CORE_FIELD_KEYS, EXTRA_FIELD_KEYS, SCORE_FIELD_KEYS, RESULT_FIELD_KEYS } from "@/lib/field-map"
import { formatFieldLabel }                     from "@/lib/field-labels"
import { cn }                                   from "@/lib/utils"
import { useDashboardStore } from "@/lib/store"
import { ExportButton } from "@/components/ExportButton"
import { csvFilename } from "@/lib/csv-export"

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

const SCORE_FIELDS  = SCORE_FIELD_KEYS
const RESULT_FIELDS = RESULT_FIELD_KEYS

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
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="h-[3px] w-full bg-primary" />
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
  const clientId = useDashboardStore((s) => s.clientId)
  const refreshKey = useDashboardStore((s) => s.refreshKey)
  const id     = params?.id as string | undefined

  // Translation
  const { language, toggleLanguage, translateTexts, translating } = useTranslation()
  const [translatedLabels, setTranslatedLabels] = useState<Record<string, string>>({})

  // Validate: ID must be a positive integer string
  const idNum = id ? parseInt(id, 10) : NaN
  const idValid = Number.isFinite(idNum) && idNum > 0 && String(idNum) === id

  const drilldownUrl = useMemo(() => {
    if (!idValid) return null
    const qs = new URLSearchParams()
    if (clientId) qs.set("clientId", clientId)
    qs.set("rk", String(refreshKey))
    const suffix = qs.toString()
    return suffix ? `/api/dashboard/drilldown/${id}?${suffix}` : `/api/dashboard/drilldown/${id}`
  }, [id, idValid, clientId, refreshKey])

  const { data, loading, error } = useApi<DrilldownData>(drilldownUrl)
  const [page,    setPage]    = useState(0)
  const [search,  setSearch]  = useState("")

  // ── Fetch ──────────────────────────────────────────────────────────────────
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
  const passed        = normalizeResult(displayResult) === "pass"

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

  // Translate visible field labels when language changes
  useEffect(() => {
    const translateFields = async () => {
      if (!visibleFields.length) {
        setTranslatedLabels({})
        return
      }

      // Get unique labels to translate (English only for input)
      const uniqueLabels = [...new Set(
        visibleFields
          .map(f => f.fieldLabel)
          .filter((label): label is string => label != null && label.length > 0)
      )]

      if (uniqueLabels.length === 0) {
        setTranslatedLabels({})
        return
      }

      // Only translate if language is not English
      if (language === 'en') {
        // For English, just map to original labels
        const labelMap: Record<string, string> = {}
        uniqueLabels.forEach((label) => {
          labelMap[label] = label
        })
        setTranslatedLabels(labelMap)
        return
      }

      // Translate to target language
      const translated = await translateTexts(uniqueLabels, language)

      // Build map: original -> translated
      const labelMap: Record<string, string> = {}
      uniqueLabels.forEach((label, idx) => {
        labelMap[label] = translated[idx]
      })

      setTranslatedLabels(labelMap)
    }

    translateFields()
  }, [language, visibleFields, translateTexts])

  const drilldownExportRows = useMemo(() => {
    if (!data) return []
    return data.fields.map((f) => ({
      savedReportId: data.savedReportId,
      usecaseId: data.usecaseId,
      date: data.date,
      fieldGroup: CORE_FIELD_KEYS.has(f.fieldKey) ? "CORE" : EXTRA_FIELD_KEYS.has(f.fieldKey) ? "EXTRA" : "OTHER",
      fieldKey: f.fieldKey,
      fieldLabel: f.fieldLabel,
      normalizedValue: f.normalizedValue,
      valueNum: f.valueNum,
      valueText: f.valueText,
      valueLongtext: f.valueLongtext,
    }))
  }, [data])

  // Reset page when search changes (done in the input handler)

  // ── Render ────────────────────────────────────────────────────────────────

  // Guard: render early if the ID is not a valid positive integer
  if (!idValid) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center p-6">
        <BarChart2 className="w-12 h-12 opacity-20 text-muted-foreground" />
        <p className="text-lg font-semibold">Invalid session ID</p>
        <p className="text-sm text-muted-foreground">
          The report ID <code className="font-mono bg-muted px-1.5 py-0.5 rounded">{id ?? "(empty)"}</code> is not valid.
          IDs must be positive integers.
        </p>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go back
        </button>
      </div>
    )
  }

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
          <h1 className="text-sm font-semibold text-primary">
            Session Detail — Report #{id}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            {/* Language toggle */}
            <button
              onClick={toggleLanguage}
              disabled={translating}
              title={`Switch to ${language === 'en' ? 'Spanish' : 'English'}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              <Globe className="w-4 h-4" />
              <span>{language.toUpperCase()}</span>
            </button>
            {translating && (
              <span className="text-xs text-muted-foreground animate-pulse">Translating...</span>
            )}
            <ExportButton
              data={drilldownExportRows}
              filename={csvFilename(`drilldown-${id ?? "unknown"}`)}
              columns={[
                { header: "Saved Report ID", value: (r) => r.savedReportId },
                { header: "Usecase ID", value: (r) => r.usecaseId },
                { header: "Date", value: (r) => r.date },
                { header: "Field Group", value: (r) => r.fieldGroup },
                { header: "Field Key", value: (r) => r.fieldKey },
                { header: "Field Label", value: (r) => r.fieldLabel },
                { header: "Normalized Value", value: (r) => r.normalizedValue },
                { header: "Value (num)", value: (r) => r.valueNum },
                { header: "Value (text)", value: (r) => r.valueText },
                { header: "Value (longtext)", value: (r) => r.valueLongtext },
              ]}
            />
          </div>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <StatChip
                icon={<Hash className="w-4 h-4" />}
                label="Report ID"
                value={`#${data.savedReportId}`}
              />
              <StatChip
                icon={<Layers className="w-4 h-4" />}
                label="Use Case"
                value={data.usecaseId != null ? `UC-${data.usecaseId}` : "—"}
              />
              <StatChip
                icon={<CalendarDays className="w-4 h-4" />}
                label="Date"
                value={data.date || "—"}
              />
              {displayScore ? (
                <StatChip
                  icon={<BarChart2 className="w-4 h-4" />}
                  label="Score"
                  value={displayScore}
                />
              ) : (
                <StatChip
                  icon={
                    displayResult ? (
                      passed
                        ? <BadgeCheck className="w-4 h-4 text-primary" />
                        : <XCircle   className="w-4 h-4 text-destructive" />
                    ) : (
                      <BarChart2 className="w-4 h-4" />
                    )
                  }
                  label="Result"
                  value={displayResult ?? "—"}
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
                      ? "bg-primary/10 text-primary"
                      : "bg-destructive/10 text-destructive"
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
                  onChange={(e) => { setSearch(e.target.value); setPage(0) }}
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
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFields.map((field, i) => {
                        const isScore   = SCORE_FIELDS.has(field.fieldKey)
                        const isResult  = RESULT_FIELDS.has(field.fieldKey)
                        const isCore    = CORE_FIELD_KEYS.has(field.fieldKey)
                        const isExtra   = EXTRA_FIELD_KEYS.has(field.fieldKey)
                        const display   = resolveDisplay(field)

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
                                <span className="ml-2 text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-primary text-primary-foreground">
                                  {isScore ? "score" : "result"}
                                </span>
                              )}
                              {isExtra && (
                                <span className="ml-2 text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-secondary text-secondary-foreground">
                                  qualitative
                                </span>
                              )}
                            </td>

                            {/* Label */}
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {field.fieldLabel
                                ? translatedLabels[field.fieldLabel] ?? formatFieldLabel(field.fieldLabel)
                                : "—"
                              }
                            </td>

                            {/* Value */}
                            <td className="px-4 py-2.5">
                              {isResult ? (
                                <span
                                  className={cn(
                                    "inline-flex px-2 py-0.5 rounded-full text-xs font-semibold",
                                    normalizeResult(display === "—" ? null : display) === "fail"
                                      ? "bg-destructive/10 text-destructive"
                                      : normalizeResult(display === "—" ? null : display) === "pass"
                                      ? "bg-primary/10 text-primary"
                                      : "text-muted-foreground"
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
