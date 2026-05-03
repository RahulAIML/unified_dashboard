"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  ArrowLeft, BarChart2, BadgeCheck, XCircle, Hash, CalendarDays,
  Layers, Globe, ChevronDown, ChevronUp, FileText, Target, Award,
  TrendingUp, MessageSquare, AlertCircle, Languages
} from "lucide-react"
import { useApi }                              from "@/lib/hooks/useApi"
import { useTranslation }                      from "@/lib/hooks/useTranslation"
import { normalizeResult, normalizeScore }     from "@/lib/kpi-builder"
import { SCORE_FIELD_KEYS, RESULT_FIELD_KEYS } from "@/lib/field-map"
import { formatFieldLabel }                    from "@/lib/field-labels"
import { cn }                                  from "@/lib/utils"
import { useDashboardStore }                   from "@/lib/store"
import { useLangStore }                        from "@/lib/lang-store"
import { ExportButton }                        from "@/components/ExportButton"
import { csvFilename }                         from "@/lib/csv-export"

// ── Types ─────────────────────────────────────────────────────────────────────

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

const SCORE_FIELDS  = SCORE_FIELD_KEYS
const RESULT_FIELDS = RESULT_FIELD_KEYS

/** Get the best human label for a field — DB label > field key, then humanize */
function getBestLabel(field: DrilldownField): string {
  return formatFieldLabel(field.fieldLabel || field.fieldKey)
}

function resolveDisplay(field: DrilldownField): string {
  const v = field.normalizedValue
  if (v === null || v === undefined) return "—"
  return String(v)
}

function isLongText(value: string): boolean {
  return value.length > 180
}

/** Categorize fields for layout */
function categorizeFields(fields: DrilldownField[]) {
  const scoreFields:   DrilldownField[] = []
  const resultFields:  DrilldownField[] = []
  const shortFields:   DrilldownField[] = []
  const longFields:    DrilldownField[] = []

  for (const f of fields) {
    if (SCORE_FIELDS.has(f.fieldKey)) {
      scoreFields.push(f)
    } else if (RESULT_FIELDS.has(f.fieldKey)) {
      resultFields.push(f)
    } else {
      const display = resolveDisplay(f)
      if (display !== "—" && isLongText(display)) {
        longFields.push(f)
      } else {
        shortFields.push(f)
      }
    }
  }

  return { scoreFields, resultFields, shortFields, longFields }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-muted" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-muted" />
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

/** Score bar card with visual indicator */
function ScoreCard({
  label,
  score,
  rawValue,
}: {
  label: string
  score: number | null
  rawValue: number | null
}) {
  const pct = score !== null ? Math.min(100, Math.max(0, score)) : null
  const color =
    pct === null     ? "bg-muted"
    : pct >= 80      ? "bg-emerald-500"
    : pct >= 60      ? "bg-primary"
    : pct >= 40      ? "bg-amber-500"
    :                  "bg-destructive"

  return (
    <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
      <div className="h-[3px] w-full bg-gradient-to-r from-primary to-accent" />
      <div className="px-4 pt-4 pb-4">
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide leading-tight pr-2">
            {label}
          </p>
          <span className="text-2xl font-extrabold tabular-nums text-foreground shrink-0">
            {pct !== null ? `${Math.round(pct)}` : "—"}
            {pct !== null && <span className="text-sm font-normal text-muted-foreground ml-0.5">pts</span>}
          </span>
        </div>
        {/* Progress bar */}
        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all duration-700", color)}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
        {rawValue !== null && rawValue !== pct && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Raw: {rawValue}
          </p>
        )}
      </div>
    </div>
  )
}

/** Expandable long-text card */
function LongTextCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = value.slice(0, 240)
  const needsTruncation = value.length > 240

  return (
    <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
      <div className="h-[2px] w-full bg-muted" />
      <div className="px-5 py-4">
        <div className="flex items-start gap-2 mb-2">
          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {label}
          </p>
        </div>
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
          {needsTruncation && !expanded ? `${preview}…` : value}
        </p>
        {needsTruncation && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {expanded
              ? <><ChevronUp className="w-3 h-3" /> Show less</>
              : <><ChevronDown className="w-3 h-3" /> Show more</>
            }
          </button>
        )}
      </div>
    </div>
  )
}

/** Compact metadata chip */
function MetaChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-[16px] border border-border/60 bg-card px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide truncate">
          {label}
        </p>
        <p className="text-sm font-bold truncate text-foreground">{value}</p>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DrilldownPage() {
  const params     = useParams()
  const router     = useRouter()
  const refreshKey = useDashboardStore((s) => s.refreshKey)
  const id         = params?.id as string | undefined

  // Translation — sync with global lang store
  const globalLang = useLangStore((s) => s.lang)
  const { language, setLanguage, translateTexts, translating } = useTranslation()
  const [translatedLabels, setTranslatedLabels] = useState<Record<string, string>>({})
  const [translatedValues, setTranslatedValues] = useState<Record<string, string>>({})
  const [showRawKeys, setShowRawKeys] = useState(false)

  // Sync drilldown language with global lang on mount & change
  useEffect(() => {
    setLanguage(globalLang)
  }, [globalLang, setLanguage])

  const toggleLanguage = useCallback(() => {
    const next = language === 'en' ? 'es' : 'en'
    setLanguage(next)
    useLangStore.getState().setLang(next)
  }, [language, setLanguage])

  // Validate ID
  const idNum   = id ? parseInt(id, 10) : NaN
  const idValid = Number.isFinite(idNum) && idNum > 0 && String(idNum) === id

  const drilldownUrl = useMemo(() => {
    if (!idValid) return null
    const qs = new URLSearchParams({ rk: String(refreshKey) })
    return `/api/dashboard/drilldown/${id}?${qs}`
  }, [id, idValid, refreshKey])

  const { data, loading, error } = useApi<DrilldownData>(drilldownUrl)

  // ── Derived ────────────────────────────────────────────────────────────────
  const { scoreFields, resultFields, shortFields, longFields } = useMemo(
    () => (data ? categorizeFields(data.fields) : { scoreFields: [], resultFields: [], shortFields: [], longFields: [] }),
    [data]
  )

  const primaryScore  = scoreFields[0]
  const primaryResult = resultFields[0]

  const normalizedScore = useMemo(
    () => primaryScore?.valueNum != null ? normalizeScore(primaryScore.valueNum) : null,
    [primaryScore]
  )

  const resultText = resolveDisplay(primaryResult ?? { normalizedValue: null } as DrilldownField)
  const passed     = normalizeResult(resultText === "—" ? null : resultText) === "pass"

  // ── All labels for translation ────────────────────────────────────────────
  const allFields = useMemo(() => data?.fields ?? [], [data])

  const uniqueDisplayLabels = useMemo(() => {
    if (!allFields.length) return []
    return [...new Set(allFields.map(getBestLabel).filter(Boolean))]
  }, [allFields])

  useEffect(() => {
    const run = async () => {
      if (language === 'en' || !uniqueDisplayLabels.length) {
        setTranslatedLabels({})
        return
      }
      try {
        const translated = await translateTexts(uniqueDisplayLabels, language)
        const map: Record<string, string> = {}
        uniqueDisplayLabels.forEach((label, i) => {
          if (translated[i]) map[label] = translated[i]
        })
        setTranslatedLabels(map)
      } catch {
        setTranslatedLabels({})
      }
    }
    run()
  }, [language, uniqueDisplayLabels, translateTexts])

  // ── Translate long text values (feedback, strengths, improvements) ──────
  const longTextValues = useMemo(() => {
    if (!allFields.length) return []
    return [...new Set(
      allFields
        .map(f => resolveDisplay(f))
        .filter(v => v !== "—" && isLongText(v))
    )]
  }, [allFields])

  useEffect(() => {
    const run = async () => {
      if (language === 'en' || !longTextValues.length) {
        setTranslatedValues({})
        return
      }
      try {
        const translated = await translateTexts(longTextValues, language)
        const map: Record<string, string> = {}
        longTextValues.forEach((val, i) => {
          if (translated[i]) map[val] = translated[i]
        })
        setTranslatedValues(map)
      } catch {
        setTranslatedValues({})
      }
    }
    run()
  }, [language, longTextValues, translateTexts])

  const getLabel = (field: DrilldownField) => {
    const base = getBestLabel(field)
    return translatedLabels[base] ?? base
  }

  const getValue = (field: DrilldownField) => {
    const display = resolveDisplay(field)
    if (display === "—" || !isLongText(display)) return display
    return translatedValues[display] ?? display
  }

  // ── Export rows ───────────────────────────────────────────────────────────
  const exportRows = useMemo(() => {
    if (!data) return []
    return data.fields.map((f) => ({
      savedReportId:  data.savedReportId,
      usecaseId:      data.usecaseId,
      date:           data.date,
      fieldName:      getBestLabel(f),
      fieldKey:       f.fieldKey,
      value:          f.normalizedValue,
    }))
  }, [data])

  // ── Invalid ID guard ──────────────────────────────────────────────────────
  if (!idValid) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center p-6">
        <AlertCircle className="w-12 h-12 opacity-20 text-muted-foreground" />
        <p className="text-lg font-semibold">Invalid Report ID</p>
        <p className="text-sm text-muted-foreground">
          The ID <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">{id ?? "(empty)"}</span> is not valid.
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

      {/* ── Sticky top bar ─────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-background/90 backdrop-blur-sm sticky top-0 z-20">
        <div
          className="h-[3px] w-full"
          style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
        />
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <h1 className="text-sm font-semibold text-foreground hidden sm:block">
            Session Report
            <span className="ml-2 font-mono text-muted-foreground text-xs font-normal">
              #{id}
            </span>
          </h1>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {/* Raw keys toggle — hidden by default, opt-in */}
            <button
              onClick={() => setShowRawKeys(!showRawKeys)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                showRawKeys
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted text-muted-foreground hover:text-foreground"
              )}
              title={showRawKeys ? 'Hide technical field keys' : 'Show technical field keys'}
            >
              <Hash className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{showRawKeys ? 'Hide Keys' : 'Show Keys'}</span>
            </button>

            {/* Language toggle: [EN | Original] */}
            <button
              onClick={toggleLanguage}
              disabled={translating}
              title={language === 'en' ? 'Translate to Spanish' : 'Show original text'}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors",
                language !== 'en'
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted text-muted-foreground hover:text-foreground",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {translating ? (
                <span className="flex items-center gap-1"><span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />Translating…</span>
              ) : (
                <>
                  <Languages className="w-3.5 h-3.5" />
                  <span>{language === 'en' ? 'EN | Original' : 'ES | Traducido'}</span>
                </>
              )}
            </button>

            <ExportButton
              data={exportRows}
              filename={csvFilename(`session-${id ?? "unknown"}`)}
              columns={[
                { header: "Report ID",   value: r => r.savedReportId },
                { header: "Use Case ID", value: r => r.usecaseId },
                { header: "Date",        value: r => r.date },
                { header: "Field Name",  value: r => r.fieldName },
                { header: "Field Key",   value: r => r.fieldKey },
                { header: "Value",       value: r => r.value },
              ]}
            />
          </div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-6">

        {loading && <Skeleton />}

        {!loading && error && <EmptyState message={`Failed to load report: ${error}`} />}
        {!loading && !error && !data && <EmptyState message="Report not found." />}

        {!loading && !error && data && (
          <>
            {/* ── Metadata strip ────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetaChip
                icon={<Hash className="w-4 h-4" />}
                label="Report ID"
                value={`#${data.savedReportId}`}
              />
              <MetaChip
                icon={<Layers className="w-4 h-4" />}
                label="Use Case"
                value={data.usecaseId != null ? `UC-${data.usecaseId}` : "—"}
              />
              <MetaChip
                icon={<CalendarDays className="w-4 h-4" />}
                label="Date"
                value={data.date || "—"}
              />
              <MetaChip
                icon={<FileText className="w-4 h-4" />}
                label="Total Fields"
                value={`${data.fields.length} recorded`}
              />
            </div>

            {/* ── Hero: Score + Result ──────────────────────────────────────── */}
            {(scoreFields.length > 0 || resultFields.length > 0) && (
              <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
                <div
                  className="h-1 w-full"
                  style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
                />
                <div className="p-5 sm:p-6 flex flex-col sm:flex-row gap-5 items-start sm:items-center">

                  {/* Score circle */}
                  {normalizedScore !== null && (
                    <div className="flex flex-col items-center justify-center shrink-0">
                      <div className="relative w-28 h-28">
                        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                          <circle
                            cx="56" cy="56" r="48"
                            fill="none"
                            className="stroke-muted"
                            strokeWidth="8"
                          />
                          <circle
                            cx="56" cy="56" r="48"
                            fill="none"
                            stroke={normalizedScore >= 80 ? "#10b981" : normalizedScore >= 60 ? "hsl(var(--primary))" : "#f59e0b"}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 48}`}
                            strokeDashoffset={`${2 * Math.PI * 48 * (1 - normalizedScore / 100)}`}
                            className="transition-all duration-1000"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-2xl font-extrabold tabular-nums">{Math.round(normalizedScore)}</span>
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">pts</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 font-medium">
                        {getLabel(scoreFields[0])}
                      </p>
                    </div>
                  )}

                  {/* Divider */}
                  {normalizedScore !== null && resultText !== "—" && (
                    <div className="hidden sm:block w-px h-20 bg-border" />
                  )}

                  {/* Result + summary */}
                  <div className="flex-1 min-w-0">
                    {resultText !== "—" && (
                      <div className="flex items-center gap-2 mb-3">
                        {passed
                          ? <BadgeCheck className="w-5 h-5 text-primary shrink-0" />
                          : <XCircle   className="w-5 h-5 text-destructive shrink-0" />
                        }
                        <span
                          className={cn(
                            "text-lg font-bold",
                            passed ? "text-primary" : "text-destructive"
                          )}
                        >
                          {resultText}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ml-1",
                            passed
                              ? "bg-primary/10 text-primary"
                              : "bg-destructive/10 text-destructive"
                          )}
                        >
                          {passed ? "PASS" : "FAIL"}
                        </span>
                      </div>
                    )}

                    {/* Extra score bars for additional score fields */}
                    {scoreFields.slice(1).map((sf) => {
                      const s = normalizeScore(sf.valueNum)
                      const pct = s !== null ? Math.min(100, Math.max(0, s)) : 0
                      return (
                        <div key={sf.fieldKey} className="mb-2 last:mb-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted-foreground">{getLabel(sf)}</span>
                            <span className="text-xs font-semibold tabular-nums">{pct}pts</span>
                          </div>
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}

                    {normalizedScore === null && resultText === "—" && (
                      <p className="text-sm text-muted-foreground">
                        No score or result recorded for this session.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Short fields grid ─────────────────────────────────────────── */}
            {shortFields.filter(f => resolveDisplay(f) !== "—").length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-muted-foreground" />
                  Evaluation Details
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {shortFields
                    .filter(f => resolveDisplay(f) !== "—")
                    .map((field) => {
                      const display = resolveDisplay(field)
                      return (
                        <div
                          key={field.fieldKey}
                          className="rounded-[16px] border border-border/60 bg-card px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]"
                        >
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 truncate">
                            {getLabel(field)}
                          </p>
                          <p className="text-sm font-medium text-foreground break-words">
                            {display}
                          </p>
                          {showRawKeys && (
                            <p className="text-[9px] font-mono text-muted-foreground/50 mt-1 truncate">
                              {field.fieldKey}
                            </p>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            {/* ── Long text fields ──────────────────────────────────────────── */}
            {longFields.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Award className="w-4 h-4 text-muted-foreground" />
                  Feedback &amp; Observations
                </h2>
                <div className="space-y-3">
                  {longFields.map((field) => (
                    <LongTextCard
                      key={field.fieldKey}
                      label={getLabel(field)}
                      value={getValue(field)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── All fields table (collapsible) ────────────────────────────── */}
            <AllFieldsTable
              fields={data.fields}
              getLabel={getLabel}
              showRawKeys={showRawKeys}
            />

            {/* ── Closing JSON ──────────────────────────────────────────────── */}
            {data.closingJson && <ClosingJsonSection json={data.closingJson} />}
          </>
        )}
      </div>
    </div>
  )
}

// ── All Fields collapsible table ──────────────────────────────────────────────

function AllFieldsTable({
  fields,
  getLabel,
  showRawKeys,
}: {
  fields:      DrilldownField[]
  getLabel:    (f: DrilldownField) => string
  showRawKeys: boolean
}) {
  const [open,   setOpen]   = useState(false)
  const [search, setSearch] = useState("")
  const [page,   setPage]   = useState(0)
  const PAGE = 25

  const filtered = useMemo(() => {
    if (!search.trim()) return fields
    const q = search.toLowerCase()
    return fields.filter(f =>
      getLabel(f).toLowerCase().includes(q) ||
      f.fieldKey.toLowerCase().includes(q) ||
      String(f.normalizedValue ?? "").toLowerCase().includes(q)
    )
  }, [fields, search, getLabel])

  const totalPages = Math.ceil(filtered.length / PAGE)
  const visible    = filtered.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
      >
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            All Recorded Fields
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fields.length} fields — click to {open ? "collapse" : "expand"}
          </p>
        </div>
        {open
          ? <ChevronUp   className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        }
      </button>

      {open && (
        <>
          <div className="px-5 pb-3 pt-0 border-b border-border flex items-center gap-3">
            <input
              type="search"
              placeholder="Search fields…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0) }}
              className="px-3 py-1.5 text-xs rounded-lg border border-border bg-muted/60 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-56"
            />
            <span className="text-xs text-muted-foreground">
              {filtered.length} of {fields.length}
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {search ? "No fields match your search." : "No fields recorded."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Field Name
                    </th>
                    {showRawKeys && (
                      <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-40">
                        Key
                      </th>
                    )}
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((field, i) => {
                    const isScore  = SCORE_FIELDS.has(field.fieldKey)
                    const isResult = RESULT_FIELDS.has(field.fieldKey)
                    const display  = resolveDisplay(field)
                    const label    = getLabel(field)

                    return (
                      <tr
                        key={field.fieldKey + i}
                        className={cn(
                          "border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors",
                          (isScore || isResult) && "bg-primary/5"
                        )}
                      >
                        {/* Field name */}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-foreground">{label}</span>
                            {isScore && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
                                Score
                              </span>
                            )}
                            {isResult && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-accent/20 text-accent-foreground">
                                Result
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Raw key (optional) */}
                        {showRawKeys && (
                          <td className="px-4 py-2.5">
                            <code className="text-[10px] font-mono text-muted-foreground/70 break-all">
                              {field.fieldKey}
                            </code>
                          </td>
                        )}

                        {/* Value */}
                        <td className="px-4 py-2.5">
                          {isResult ? (
                            <span className={cn(
                              "inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold",
                              normalizeResult(display === "—" ? null : display) === "fail"
                                ? "bg-destructive/10 text-destructive"
                                : normalizeResult(display === "—" ? null : display) === "pass"
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground"
                            )}>
                              {display}
                            </span>
                          ) : isScore ? (
                            <span className="font-bold tabular-nums text-foreground">
                              {field.valueNum !== null
                                ? `${Math.round(normalizeScore(field.valueNum) ?? 0)} pts`
                                : "—"}
                            </span>
                          ) : (
                            <span className={cn(
                              "text-sm break-words",
                              display === "—" && "text-muted-foreground"
                            )}>
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
              <p className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Closing JSON section ──────────────────────────────────────────────────────

function ClosingJsonSection({ json }: { json: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)

  const entries = Object.entries(json).filter(([, v]) => v !== null && v !== "")

  if (entries.length === 0) return null

  return (
    <div className="rounded-[16px] border border-border/60 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
      >
        <div>
          <p className="text-sm font-semibold flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            Closing Report Data
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entries.length} additional fields from closing report
          </p>
        </div>
        {open
          ? <ChevronUp   className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        }
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            {entries.map(([key, value]) => {
              const displayVal = typeof value === 'object' ? JSON.stringify(value) : String(value)
              const isLong = displayVal.length > 120

              return (
                <div
                  key={key}
                  className={cn(
                    "rounded-lg border border-border bg-muted/30 px-4 py-3",
                    isLong && "sm:col-span-2"
                  )}
                >
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                    {formatFieldLabel(key)}
                  </p>
                  <p className="text-sm text-foreground break-words whitespace-pre-wrap">
                    {displayVal}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
