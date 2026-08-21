'use client'

/**
 * Renders a dashboard purely from AI-service metadata + live widget data.
 * The same component powers the builder's preview and the published /d/[slug]
 * page — the frontend never has per-connector code; it draws whatever the
 * config describes. This is the "metadata over code generation" contract.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useT, useLangStore } from '@/lib/lang-store'
import { translateGeneratedText, translateColumnHeader, translateResultValue, translateLegend } from '@/lib/generated-content-i18n'
import { motion } from 'framer-motion'
import { PlayCircle, Target, TrendingUp, TrendingDown, Minus, BadgeCheck, Trophy, AlertTriangle } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { ExportButton } from './ExportButton'
import { EmptyState } from './EmptyState'
import { csvFilename } from '@/lib/csv-export'
import { cn } from '@/lib/utils'

// prev_value/delta_pct: period-over-period comparison (ai-service's
// preview_fetch.py's _rolplay_app_kpi_metrics + WidgetPreview.delta_pct) —
// mirrors the hand-built Overview's "vs previous period" arrows exactly
// (lib/kpi-builder.ts's calcDeltaPct). Absent/null for every widget with no
// real previous-period baseline to compare against (never fabricated).
export interface WidgetPreview { widget_id: string; ok: boolean; value?: number | string | null; series?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; error?: string | null; prev_value?: number | string | null; delta_pct?: number | null; legend?: string | null }
// id_field: which key in each row of a `table` widget is a real, click-
// through-able report id (see ai-service's WidgetConfig.id_field) — set only
// for connectors with a verified matching /drilldown/[id] backend. Absent
// means this table's rows have no drillable id.
// business_question: the real business question this widget answers, in
// plain language (ai-service's semantic layer) — shown as a subtitle.
// paginated/searchable/exportable: a Reports-page table (ai-service's
// dashboard_planning.py::_reports_page), distinct from a small capped
// breakdown/drilldown table — real client-side pagination/search over the
// full fetched dataset, plus a CSV export of whatever is currently filtered.
export interface WidgetConfig {
  id: string; type: string; title: string; metric_key?: string | null; span?: number
  id_field?: string | null; business_question?: string | null
  paginated?: boolean; searchable?: boolean; exportable?: boolean
}
export interface DashRow { id: string; title?: string | null; widgets: WidgetConfig[] }
// A real navigable page (Overview/LMS/Coach/...) — see ai-service's
// DashboardPage model. Optional/absent on a config built before multi-page
// generation existed; DashboardRenderer falls back to flat `rows` then.
// mandatory: a service the manager explicitly contracted (ai-service's
// GenerateRequest.services) but for which no data was discovered -- render
// an honest "no data yet" state (below) instead of this page never
// appearing in `pages` at all. Absent/false for every real, data-backed page.
export interface DashPage { id: string; title: string; rows: DashRow[]; mandatory?: boolean }
export interface DashboardConfig {
  company: string; slug: string; title: string; connector: string
  rows: DashRow[]; pages?: DashPage[]; recommendations: string[]
  // Evidence-backed narrative sentences generated from the ACTUAL fetched
  // data (ai-service's agents/insights.py) — distinct from `recommendations`,
  // which are derived from the schema alone before any real value exists.
  // Absent/empty for every connector this hasn't been built for yet.
  insights?: string[]
  // Closing criterion: set by an admin before sharing a published link
  // outside the normal authenticated tenant flow (ai-service's
  // DashboardConfig.confidential). Absent/false for every config built
  // before this field existed.
  confidential?: boolean
}

// Must match ai-service's preview_fetch.py BEST_PERFORMERS_ID — routed by
// widget id (like id_field/paginated elsewhere), since this leaderboard's
// rows are an aggregation of already-real per-user data, not a standalone
// discovered metric with its own metric_key.
const BEST_PERFORMERS_ID = 'table_best_performers'

export function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2)
  return String(v)
}

// "pharma_*" connector kinds are an internal technical label (this data-fetch
// pattern was first built for pharma clients) — it has no bearing on what
// industry a company is actually in. Heineken (beverages), Lacoste (apparel),
// M8, etc. use these exact same connectors. Never show the raw internal name
// to a manager; always show what it actually is.
const CONNECTOR_LABELS: Record<string, { en: string; es: string }> = {
  pharma_kpi: { en: 'Structured analytics feed', es: 'Fuente de analítica estructurada' },
  pharma_sale_exercises: { en: 'Practice session log', es: 'Registro de sesiones de práctica' },
  pharma_exceltis_rest: { en: 'Activity tracking system', es: 'Sistema de seguimiento de actividad' },
  coach_app_sql: { en: 'Coaching database', es: 'Base de datos de coaching' },
  second_brain: { en: 'Second Brain', es: 'Second Brain' },
  rolplay_app_sql: { en: 'Session log (counts only)', es: 'Registro de sesiones (solo conteos)' },
}

export function humanizeConnector(connector: string | null | undefined, lang: 'en' | 'es' = 'en'): string {
  if (!connector) return lang === 'es' ? 'Desconocido' : 'Unknown'
  const label = CONNECTOR_LABELS[connector]
  return label ? label[lang] : connector.replace(/_/g, ' ')
}

// Cycled by KPI position, matching DashboardContent.tsx's own `kpiIcons`
// array exactly (PlayCircle/Target/TrendingUp/BadgeCheck) — the AI-generated
// dashboard has no curated per-metric icon set, so this gives it the same
// polished "every tile has an icon badge" feel without guessing a specific
// icon per metric_key.
const KPI_ICONS = [
  <PlayCircle key="p" className="w-4 h-4" />,
  <Target key="t" className="w-4 h-4" />,
  <TrendingUp key="tr" className="w-4 h-4" />,
  <BadgeCheck key="b" className="w-4 h-4" />,
]

const cardMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  whileHover: { y: -3, transition: { duration: 0.2 } },
}

/**
 * KPI tile — pixel-for-pixel the same visual language as the hand-built
 * SummaryCard (components/SummaryCard.tsx): gradient top stripe, icon badge,
 * large bold value, and a colored delta pill with a Trending/Minus icon
 * rather than plain arrow text. Absent delta_pct (no real previous-period
 * baseline) renders the same neutral "no comparison" pill SummaryCard shows
 * for a snapshot metric, never a fabricated 0%.
 */
function KpiTile({ title, value, deltaPct, legend, index }: { title: string; value: unknown; deltaPct?: number | null; legend?: string | null; index: number }) {
  const t = useT()
  const hasDelta = deltaPct !== null && deltaPct !== undefined
  const isPositive = hasDelta && deltaPct! > 0
  const isNegative = hasDelta && deltaPct! < 0
  return (
    <motion.div
      {...cardMotion}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="relative w-full overflow-hidden rounded-[16px] border border-border/50 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_12px_20px_-5px_rgba(0,0,0,0.08),0_4px_8px_-4px_rgba(0,0,0,0.05)] transition-all duration-300 ease-out"
    >
      <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))' }} />
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider leading-none">{title}</span>
          <div
            className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-primary"
            style={{ background: 'linear-gradient(135deg, hsl(var(--primary)/0.12), hsl(var(--accent)/0.08))' }}
          >
            {KPI_ICONS[index % KPI_ICONS.length]}
          </div>
        </div>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="kpi-value text-[32px] sm:text-[36px] leading-none font-bold text-foreground tracking-tight">{fmt(value)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold',
            isPositive ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : isNegative ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                : 'bg-muted text-muted-foreground',
          )}>
            {isPositive && <TrendingUp className="w-3 h-3" />}
            {isNegative && <TrendingDown className="w-3 h-3" />}
            {!isPositive && !isNegative && <Minus className="w-3 h-3" />}
            <span>{hasDelta ? `${isPositive ? '+' : ''}${deltaPct}%` : '—'}</span>
          </div>
          <span className="text-xs text-muted-foreground/70">{hasDelta ? t.vsPrior : t.noHistoricalComparison}</span>
        </div>
        {legend && (
          <p className="text-[11px] text-muted-foreground/80 mt-2.5 pt-2.5 border-t border-border/50">{legend}</p>
        )}
      </div>
    </motion.div>
  )
}

/**
 * Chart/table card chrome — the same visual language as the hand-built
 * ChartCard (components/ChartCard.tsx): gradient top stripe, title + subtitle
 * header, padded content area. Every non-KPI widget renders inside this so
 * the whole page reads as one consistent card system, not a mix of a
 * polished KPI row and a plain bordered box for everything else.
 */
function WidgetCard({ title, subtitle, headerAction, index, children }: {
  title: string; subtitle?: string | null; headerAction?: React.ReactNode; index: number; children: React.ReactNode
}) {
  return (
    <motion.div
      {...cardMotion}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      className="relative overflow-hidden rounded-[16px] border border-border/50 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_12px_20px_-5px_rgba(0,0,0,0.08),0_4px_8px_-4px_rgba(0,0,0,0.05)] transition-all duration-300 ease-out"
    >
      <div className="h-[3px] w-full" style={{ background: 'linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))' }} />
      <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-0 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-foreground leading-tight tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed italic">{subtitle}</p>}
        </div>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 sm:pb-6">
        <div className="w-full max-w-full overflow-hidden"><div className="min-w-0">{children}</div></div>
      </div>
    </motion.div>
  )
}

// Rank-badge palette (gold/silver/bronze, then a neutral primary tint) — must
// match DashboardContent.tsx's own Best Performers card exactly, idx by idx.
const RANK_BADGE_CLASSES = [
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 shadow-sm',
  'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 shadow-sm',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 shadow-sm',
]

/**
 * Top-users-by-average-score leaderboard — the same row layout as the
 * hand-built Overview's Best Performers card (components/DashboardContent.tsx):
 * gold/silver/bronze rank badges, name + email, then right-aligned Sessions /
 * Avg Score / Pass Rate columns with tiny uppercase labels. This widget is
 * wrapped in a WidgetCard with a Trophy icon header action, matching that
 * card's own header exactly.
 */
function Leaderboard({ rows }: { rows: Record<string, unknown>[] }) {
  const t = useT()
  if (!rows.length) return <div className="text-sm text-muted-foreground">—</div>
  return (
    <div className="space-y-2">
      {rows.slice(0, 10).map((r, idx) => {
        const displayName = fmt(r.user_name) !== '—' ? fmt(r.user_name) : fmt(r.user_email)
        // A performer's OWN pass rate is what the hand-built reference leaderboards
        // (e.g. the standalone Siigo dashboard's "Mejores Desempeños") show as a
        // colored up/down indicator per row -- there's no real "vs their own prior
        // period" baseline for a single rep, so this reads as a performance
        // indicator (majority of their sessions passed = good), not a period delta.
        const passRateNum = Number(r.pass_rate)
        const goodPassRate = Number.isFinite(passRateNum) && passRateNum >= 50
        return (
          <div key={idx} className="flex items-center justify-between p-3 sm:p-4 rounded-xl bg-muted/30 hover:bg-muted/50 transition-all duration-200 gap-3">
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
              <div className={cn(
                'flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-xl font-bold text-xs sm:text-sm shrink-0',
                RANK_BADGE_CLASSES[idx] ?? 'bg-primary/10 text-primary',
              )}>
                {idx + 1}
              </div>
              <div className="min-w-0">
                <p className="text-sm sm:text-base font-semibold text-foreground truncate">{displayName}</p>
                {displayName !== fmt(r.user_email) && <p className="text-xs text-muted-foreground truncate">{fmt(r.user_email)}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3 sm:gap-6 text-right shrink-0">
              <div className="hidden sm:block">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.sessionsLabel}</p>
                <p className="text-sm font-bold text-foreground tabular-nums">{fmt(r.sessions)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.colAvgScoreShort}</p>
                <p className="text-sm font-bold text-foreground tabular-nums">{fmt(r.avg_score)} <span className="text-xs font-normal text-muted-foreground">{t.unitPts}</span></p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{t.passRate}</p>
                <p className={cn(
                  'text-sm font-bold tabular-nums inline-flex items-center gap-1',
                  goodPassRate ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}>
                  {goodPassRate ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {fmt(r.pass_rate)}%
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DashboardRows({ rows, pv }: { rows: DashRow[]; pv: Map<string, WidgetPreview> }) {
  const t = useT()
  const { lang } = useLangStore()
  return (
    <div className="space-y-5 sm:space-y-6">
      {rows.map(row => (
        <div key={row.id}>
          {row.title && <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">{translateGeneratedText(row.title, lang)}</div>}
          {row.widgets.length === 0 ? (
            // A section the manager explicitly contracted (mandatory), but with
            // no data discovered yet -- shown honestly, never silently omitted.
            <EmptyState
              title={t.sectionNoDataTitle}
              message={t.sectionNoDataMsg}
            />
          ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
            {row.widgets.map((w, i) => {
              const p = pv.get(w.id)
              const wide = w.type !== 'kpi_tile'
              const isLeaderboard = w.type === 'table' && w.id.endsWith(BEST_PERFORMERS_ID)
              const failed = !!p && !p.ok
              return (
                <div key={w.id} className={wide ? 'sm:col-span-2 lg:col-span-4' : ''}>
                  {w.type === 'kpi_tile' ? (
                    <KpiTile title={translateGeneratedText(w.title, lang)} value={p?.value} deltaPct={p?.delta_pct} legend={translateLegend(p?.legend, lang)} index={i} />
                  ) : (
                    <WidgetCard
                      title={translateGeneratedText(w.title, lang)}
                      subtitle={translateGeneratedText(w.business_question, lang)}
                      index={i}
                      headerAction={isLeaderboard ? (
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, hsl(var(--primary)/0.12), hsl(var(--accent)/0.08))' }}>
                          <Trophy className="w-4 h-4 text-primary" />
                        </div>
                      ) : undefined}
                    >
                      {(w.type === 'line_chart' || w.type === 'bar_chart' || w.type === 'histogram') &&
                        <MiniChart series={p?.series ?? p?.rows ?? []} bar={w.type !== 'line_chart'} />}
                      {w.type === 'donut' && <MiniDonut rows={p?.rows ?? []} />}
                      {w.type === 'journey' && <MiniJourney rows={p?.rows ?? []} />}
                      {isLeaderboard && <Leaderboard rows={p?.rows ?? []} />}
                      {w.type === 'table' && !isLeaderboard && (w.paginated
                        ? <ReportsTable rows={p?.rows ?? []} searchable={!!w.searchable} exportable={!!w.exportable} filenamePrefix={w.id} />
                        : <MiniTable rows={p?.rows ?? []} idField={w.id_field} />)}
                      {failed && <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">{t.noDataInline}{p!.error ? `: ${p!.error}` : ''}</div>}
                    </WidgetCard>
                  )}
                  {w.type === 'kpi_tile' && failed && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 px-1">{t.noDataInline}{p!.error ? `: ${p!.error}` : ''}</div>
                  )}
                </div>
              )
            })}
          </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Real page navigation (tabs), not one flat scrolling page — the reference
 * hand-built app has ~10 distinct pages (Overview/LMS/Coach/Simulator/...);
 * every AI-generated dashboard used to be exactly one page regardless. Falls
 * back to the old flat-rows rendering when `config.pages` is absent/empty
 * (a config built before multi-page generation existed, or one page's worth
 * of content) — so nothing regresses for an older cached config.
 */
/**
 * One alert-style card per insight -- matches the hand-built reference
 * dashboards' "Insights IA" treatment (a warning-icon, red-tinted card per
 * finding) rather than a single shared box with a bulleted list. Each
 * sentence is still exactly what agents/insights.py generated (evidence-
 * backed, grounded in real fetched data) -- only the presentation changed.
 */
function AIInsights({ insights }: { insights: string[] }) {
  if (!insights.length) return null
  return (
    <div className="mb-5 space-y-2">
      {insights.map((s, i) => (
        <div key={i} className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <p className="text-sm text-foreground leading-relaxed">{s}</p>
        </div>
      ))}
    </div>
  )
}

export function DashboardRenderer({ config, preview }: { config: DashboardConfig; preview: { widgets: WidgetPreview[] } }) {
  const { lang } = useLangStore()
  const pv = new Map(preview.widgets.map(w => [w.widget_id, w]))
  const pages = config.pages ?? []
  const [activeId, setActiveId] = useState<string | null>(pages[0]?.id ?? null)

  if (pages.length === 0) {
    return (
      <div>
        <AIInsights insights={config.insights ?? []} />
        <DashboardRows rows={config.rows} pv={pv} />
      </div>
    )
  }

  const active = pages.find(p => p.id === activeId) ?? pages[0]

  return (
    <div>
      <AIInsights insights={config.insights ?? []} />
      {pages.length > 1 && (
        <div className="flex gap-1 mb-5 border-b border-border/60 overflow-x-auto" role="tablist">
          {pages.map(p => (
            <button
              key={p.id}
              role="tab"
              aria-selected={p.id === active.id}
              onClick={() => setActiveId(p.id)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                p.id === active.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {translateGeneratedText(p.title, lang)}
            </button>
          ))}
        </div>
      )}
      <DashboardRows rows={active.rows} pv={pv} />
    </div>
  )
}

function normalizeChartRow(r: Record<string, unknown>, i: number): { label: string; value: number; passedValue: number | null } {
  const rawLabel = r.label ?? r.date ?? r.activity ?? r.usecase ?? r.simulator ?? r.range ?? i
  const passed = r.passed_sessions ?? r.passed
  return {
    label: String(rawLabel),
    value: Number(r.value ?? r.total_sessions ?? r.sessions ?? r.count ?? 0),
    // Only some connectors/widgets carry a passed/failed breakdown alongside
    // the total — null (not 0) when absent, so MiniChart can tell "no
    // breakdown available" apart from "zero passed" and skip the second bar.
    passedValue: passed === null || passed === undefined ? null : Number(passed),
  }
}

/** Truncates a long category name for the X axis; the full name still shows in the tooltip. */
function truncateTick(label: string, max = 14): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

function ChartTooltip({
  active, payload, label,
}: {
  active?: boolean
  payload?: { value?: number | string; payload?: { label?: string } }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  // The tick label may be truncated; the full untruncated label travels with
  // the data point itself and is what we show here.
  const fullLabel = payload[0]?.payload?.label ?? label
  return (
    <div className="bg-card/95 backdrop-blur-sm border border-border/60 rounded-xl px-3 py-2 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] text-xs max-w-[220px]">
      <p className="font-semibold text-foreground break-words">{fullLabel}</p>
      <p className="text-primary font-medium">{payload[0]?.value?.toLocaleString?.() ?? payload[0]?.value}</p>
    </div>
  )
}

/**
 * Real chart, not a placeholder — this replaced a version that drew flat
 * solid-color rectangles (bars only, even for "line_chart" widgets) with no
 * axis, no scale reference, and no visible value on small bars. That became a
 * genuine problem on real data: Siigo's per-simulator session counts are
 * 129 / 8 / 4 / 3 — a ~40:1 range — so on a plain linear-height bar the three
 * smaller ones are indistinguishable slivers with nothing indicating they are
 * 8, 4, and 3 rather than all "small". A real axis plus an always-on value
 * label (not just on hover) is what makes a skewed real-world distribution
 * like that legible, not just technically-correctly-proportioned.
 *
 * line_chart now draws an actual line (not bars); bar_chart draws bars with
 * the true count printed above each one regardless of its height.
 */
export function MiniChart({ series, bar }: { series: Record<string, unknown>[]; bar?: boolean }) {
  const t = useT()
  const data = series.slice(0, 14).map(normalizeChartRow)
  if (!data.length) {
    return <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">—</div>
  }

  const tickProps = { fontSize: 11, fill: 'currentColor', opacity: 0.5, fontWeight: 500 } as const
  // Some connectors return a passed-count alongside the total (e.g. per
  // simulator/activity/usecase) — when they do, show Total vs Passed as a
  // grouped bar (mirrors the real hand-built Overview page's "Sessions by
  // Use Case" chart) instead of just the total.
  const hasPassed = bar && data.some(d => d.passedValue !== null)

  return (
    <div className="w-full h-40 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        {bar ? (
          <BarChart data={data} margin={{ top: 20, right: 8, left: -20, bottom: hasPassed ? 20 : 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" strokeOpacity={0.06} vertical={false} />
            <XAxis dataKey="label" tickFormatter={truncateTick} tick={tickProps} axisLine={false} tickLine={false} dy={6} />
            <YAxis tick={tickProps} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'currentColor', opacity: 0.05 }} />
            {hasPassed && <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 11 }} />}
            <Bar dataKey="value" name={t.colTotal} fill="var(--chart-1, hsl(var(--primary)))" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {/* Always-visible label so a tiny bar (e.g. 3 sessions next to
                  129) still shows its real number instead of reading as an
                  unlabeled sliver indistinguishable from zero. */}
              <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: 'currentColor', opacity: 0.7 }} />
            </Bar>
            {hasPassed && (
              <Bar dataKey="passedValue" name={t.colPassed} fill="var(--chart-2, hsl(var(--accent)))" radius={[4, 4, 0, 0]} maxBarSize={56}>
                <LabelList dataKey="passedValue" position="top" style={{ fontSize: 11, fill: 'currentColor', opacity: 0.7 }} />
              </Bar>
            )}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" strokeOpacity={0.06} vertical={false} />
            <XAxis dataKey="label" tickFormatter={truncateTick} tick={tickProps} axisLine={false} tickLine={false} dy={6} />
            <YAxis tick={tickProps} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'currentColor', strokeOpacity: 0.15 }} />
            <Line
              type="monotone" dataKey="value"
              stroke="var(--chart-1, hsl(var(--primary)))" strokeWidth={2}
              dot={{ r: 3, fill: 'var(--chart-1, hsl(var(--primary)))' }}
              // A single point has no line SEGMENT to draw — isAnimationActive
              // off avoids a distracting draw-in animation on a lone dot, and
              // the dot itself (set above) is what actually renders in that case.
              isAnimationActive={data.length > 1}
            >
              <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: 'currentColor', opacity: 0.7 }} />
            </Line>
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Solution Journey widget — the tenant's real modules in fixed progression
 * order (LMS -> Master Coach -> Practice Simulator -> Certification ->
 * Second Brain; see ai-service/app/journey.py), each with its own real
 * session count and pass rate. Mirrors the hand-built /journey page's
 * per-stage cards (app/journey/page.tsx), condensed to fit inside a
 * dashboard widget rather than a full page — same ordering, same "every
 * stage reports its own metric on its own scale" rule, no cross-stage funnel.
 */
export function MiniJourney({ rows }: { rows: Record<string, unknown>[] }) {
  const t = useT()
  const { lang } = useLangStore()
  const journeyPhaseLabels: Record<string, string> = {
    cognitive: t.journeyPhaseCognitive,
    practice: t.journeyPhasePractice,
    validation: t.journeyPhaseValidation,
    excellence: t.journeyPhaseExcellence,
  }
  if (!rows.length) {
    return <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">—</div>
  }
  return (
    <div className="flex items-stretch gap-2 mt-2 overflow-x-auto pb-1">
      {rows.map((r, i) => {
        const label = translateGeneratedText(String(r.label ?? r.module ?? '—'), lang)
        const phase = String(r.phase ?? '')
        const total = Number(r.total_sessions ?? 0)
        const passRate = r.pass_rate === null || r.pass_rate === undefined ? null : Number(r.pass_rate)
        return (
          <div key={i} className="flex items-center gap-2 shrink-0">
            <div className="w-36 rounded-lg border border-border/60 bg-background p-3">
              {phase && (
                <p className="text-[9px] font-semibold uppercase tracking-wide text-primary/70">
                  {journeyPhaseLabels[phase] ?? phase}
                </p>
              )}
              <p className="text-sm font-semibold text-foreground mt-0.5">{label}</p>
              <p className="text-xl font-bold text-foreground mt-1">{total.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">{t.sessionsLabel}</p>
              {passRate !== null && (
                <>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                    <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, passRate))}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{passRate}% {t.passRate}</p>
                </>
              )}
            </div>
            {/* Arrow between consecutive stages, never after the last. */}
            {i < rows.length - 1 && (
              <span className="text-muted-foreground/40 text-lg" aria-hidden="true">→</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const DONUT_PALETTE = [
  'var(--chart-1, hsl(var(--primary)))',
  'var(--chart-2, hsl(var(--accent)))',
  'var(--chart-3, #f59e0b)',
  'var(--chart-4, #10b981)',
  'var(--chart-5, #8b5cf6)',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
]

function DonutTooltip({ active, payload }: { active?: boolean; payload?: { name?: string; value?: number }[] }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card/95 backdrop-blur-sm border border-border/60 rounded-xl px-3 py-2 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] text-xs">
      <p className="font-semibold text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">{fmt(payload[0].value)}</p>
    </div>
  )
}

/**
 * Session-share and Pass/Fail donuts. The real, hand-built Overview page
 * (components/charts/DonutChart.tsx's "Use Case Distribution" and "Approval
 * vs. Disapproval" usages) always pairs a bar/table breakdown with one of
 * these — the AI-built dashboard had no renderer for the `donut` widget type
 * at all, so a donut widget the planner produced would show as a blank box.
 */
export function MiniDonut({ rows }: { rows: Record<string, unknown>[] }) {
  const t = useT()
  const { lang } = useLangStore()
  const points = rows.slice(0, 30).map(normalizeChartRow)
  if (!points.length) {
    return <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">—</div>
  }

  // Cap to the top slices + an "Other" bucket so a dimension with many
  // categories (e.g. 10+ activities) stays legible instead of a wheel of
  // slivers no one can read.
  const MAX_SLICES = 7
  const sorted = [...points].sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, MAX_SLICES)
  const restTotal = sorted.slice(MAX_SLICES).reduce((s, r) => s + r.value, 0)
  const data = restTotal > 0 ? [...top, { label: t.otherLabel, value: restTotal, passedValue: null }] : top
  const total = data.reduce((s, d) => s + d.value, 0)
  // Labels here are backend-generated enum strings (e.g. "Passed"/"Failed",
  // "Basic (<75)") from a closed vocabulary -- translate the same way widget
  // titles are, via the exact-match dictionary, never a raw pass-through.
  const displayData = data.map(d => ({ ...d, label: translateGeneratedText(d.label, lang) }))

  return (
    <div className="flex flex-col items-center gap-2 mt-2">
      <div className="relative w-40 h-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={displayData} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
              {displayData.map((_, i) => <Cell key={i} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />)}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{t.colTotal}</p>
            <p className="text-lg font-bold text-foreground">{total.toLocaleString()}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center max-w-full">
        {displayData.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length] }} />
            <span className="text-[11px] text-muted-foreground truncate max-w-[100px]" title={d.label}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MiniTable({ rows, idField }: { rows: Record<string, unknown>[]; idField?: string | null }) {
  const t = useT()
  const { lang } = useLangStore()
  if (!rows.length) return <div className="text-sm text-muted-foreground">—</div>
  // The id itself isn't interesting to show as a column (it's an opaque
  // report id) — it's what the "View" link's href is built from instead.
  const cols = Object.keys(rows[0]).filter(c => c !== idField).slice(0, 5)
  return (
    <div className="overflow-x-auto mt-1">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground text-left">
            {cols.map(c => <th key={c} className="py-1 pr-4 font-medium capitalize">{translateColumnHeader(c, lang)}</th>)}
            {idField && <th className="py-1 pr-4 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((r, i) => {
            const id = idField ? r[idField] : null
            return (
              <tr key={i} className="border-t border-border/40">
                {cols.map(c => <td key={c} className="py-1 pr-4 text-foreground">{c === 'result' ? translateResultValue(fmt(r[c]), lang) : fmt(r[c])}</td>)}
                {idField && (
                  <td className="py-1 pr-4">
                    {id !== null && id !== undefined && (
                      <Link href={`/drilldown/${id}`} className="text-primary hover:underline whitespace-nowrap">
                        {t.viewLink} →
                      </Link>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const REPORTS_PAGE_SIZE = 25

/**
 * A real Reports table (ai-service's dashboard_planning.py::_reports_page):
 * client-side search + pagination over the full fetched dataset (already
 * capped to a bounded real row count server-side), plus CSV export of
 * whatever the user currently has filtered — not a decorative flag, an
 * actually usable report.
 */
export function ReportsTable({
  rows, searchable, exportable, filenamePrefix,
}: {
  rows: Record<string, unknown>[]
  searchable: boolean
  exportable: boolean
  filenamePrefix: string
}) {
  const t = useT()
  const { lang } = useLangStore()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  const cols = rows.length ? Object.keys(rows[0]) : []

  const filtered = useMemo(() => {
    if (!query.trim()) return rows
    const q = query.toLowerCase()
    return rows.filter(r => cols.some(c => fmt(r[c]).toLowerCase().includes(q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / REPORTS_PAGE_SIZE))
  const pageSafe = Math.min(page, totalPages - 1)
  const visible = filtered.slice(pageSafe * REPORTS_PAGE_SIZE, (pageSafe + 1) * REPORTS_PAGE_SIZE)

  if (!rows.length) return <div className="text-sm text-muted-foreground">—</div>

  return (
    <div className="mt-1 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {searchable ? (
          <input
            type="search"
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(0) }}
            placeholder={t.searchPlaceholder}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-muted/60 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
          />
        ) : <span />}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">{t.rowsCountLabel.replace('{count}', String(filtered.length)).replace('{plural}', filtered.length === 1 ? '' : 's')}</span>
          {exportable && (
            <ExportButton
              data={filtered}
              columns={cols.map(c => ({
                header: translateColumnHeader(c, lang),
                value: (r: Record<string, unknown>) => c === 'result' ? translateResultValue(fmt(r[c]), lang) : r[c],
              }))}
              filename={csvFilename(filenamePrefix)}
              minWidth="min-w-[90px]"
            />
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground text-left">
              {cols.map(c => <th key={c} className="py-1 pr-4 font-medium capitalize">{translateColumnHeader(c, lang)}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className="border-t border-border/40">
                {cols.map(c => <td key={c} className="py-1 pr-4 text-foreground">{c === 'result' ? translateResultValue(fmt(r[c]), lang) : fmt(r[c])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">{t.noMatchingRows}</div>}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-muted-foreground">{t.pageOfLabel.replace("{current}", String(pageSafe + 1)).replace("{total}", String(totalPages))}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={pageSafe === 0}
              className="px-2.5 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t.drilldownPrevious}
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={pageSafe >= totalPages - 1}
              className="px-2.5 py-1 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t.drilldownNext}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
