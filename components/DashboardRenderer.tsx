'use client'

/**
 * Renders a dashboard purely from AI-service metadata + live widget data.
 * The same component powers the builder's preview and the published /d/[slug]
 * page — the frontend never has per-connector code; it draws whatever the
 * config describes. This is the "metadata over code generation" contract.
 */

import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList, PieChart, Pie, Cell, Legend,
} from 'recharts'

export interface WidgetPreview { widget_id: string; ok: boolean; value?: number | string | null; series?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; error?: string | null }
export interface WidgetConfig { id: string; type: string; title: string; metric_key?: string | null; span?: number }
export interface DashRow { id: string; title?: string | null; widgets: WidgetConfig[] }
export interface DashboardConfig { company: string; slug: string; title: string; connector: string; rows: DashRow[]; recommendations: string[] }

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
const CONNECTOR_LABELS: Record<string, string> = {
  pharma_kpi: 'Structured analytics feed',
  pharma_sale_exercises: 'Practice session log',
  pharma_exceltis_rest: 'Activity tracking system',
  coach_app_sql: 'Coaching database',
  second_brain: 'Second Brain',
  rolplay_app_sql: 'Session log (counts only)',
}

export function humanizeConnector(connector: string | null | undefined): string {
  if (!connector) return 'Unknown'
  return CONNECTOR_LABELS[connector] ?? connector.replace(/_/g, ' ')
}

export function DashboardRenderer({ config, preview }: { config: DashboardConfig; preview: { widgets: WidgetPreview[] } }) {
  const pv = new Map(preview.widgets.map(w => [w.widget_id, w]))
  return (
    <div className="space-y-5">
      {config.rows.map(row => (
        <div key={row.id}>
          {row.title && <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{row.title}</div>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {row.widgets.map(w => {
              const p = pv.get(w.id)
              const wide = w.type !== 'kpi_tile'
              return (
                <div key={w.id} className={`rounded-xl border border-border/60 bg-background p-4 ${wide ? 'col-span-2 md:col-span-4' : ''}`}>
                  <div className="text-xs text-muted-foreground mb-1">{w.title}</div>
                  {w.type === 'kpi_tile' && <div className="text-2xl font-bold text-foreground">{fmt(p?.value)}</div>}
                  {(w.type === 'line_chart' || w.type === 'bar_chart' || w.type === 'histogram') &&
                    <MiniChart series={p?.series ?? p?.rows ?? []} bar={w.type !== 'line_chart'} />}
                  {w.type === 'donut' && <MiniDonut rows={p?.rows ?? []} />}
                  {w.type === 'journey' && <MiniJourney rows={p?.rows ?? []} />}
                  {w.type === 'table' && <MiniTable rows={p?.rows ?? []} />}
                  {p && !p.ok && <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">no data{p.error ? `: ${p.error}` : ''}</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
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
            <Bar dataKey="value" name="Total" fill="var(--chart-1, hsl(var(--primary)))" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {/* Always-visible label so a tiny bar (e.g. 3 sessions next to
                  129) still shows its real number instead of reading as an
                  unlabeled sliver indistinguishable from zero. */}
              <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: 'currentColor', opacity: 0.7 }} />
            </Bar>
            {hasPassed && (
              <Bar dataKey="passedValue" name="Passed" fill="var(--chart-2, hsl(var(--accent)))" radius={[4, 4, 0, 0]} maxBarSize={56}>
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

const JOURNEY_PHASE_LABELS: Record<string, string> = {
  cognitive: 'Cognitive',
  practice: 'Practice',
  validation: 'Validation',
  excellence: 'Excellence',
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
  if (!rows.length) {
    return <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">—</div>
  }
  return (
    <div className="flex items-stretch gap-2 mt-2 overflow-x-auto pb-1">
      {rows.map((r, i) => {
        const label = String(r.label ?? r.module ?? '—')
        const phase = String(r.phase ?? '')
        const total = Number(r.total_sessions ?? 0)
        const passRate = r.pass_rate === null || r.pass_rate === undefined ? null : Number(r.pass_rate)
        return (
          <div key={i} className="flex items-center gap-2 shrink-0">
            <div className="w-36 rounded-lg border border-border/60 bg-background p-3">
              {phase && (
                <p className="text-[9px] font-semibold uppercase tracking-wide text-primary/70">
                  {JOURNEY_PHASE_LABELS[phase] ?? phase}
                </p>
              )}
              <p className="text-sm font-semibold text-foreground mt-0.5">{label}</p>
              <p className="text-xl font-bold text-foreground mt-1">{total.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground">sessions</p>
              {passRate !== null && (
                <>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-2">
                    <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, passRate))}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">{passRate}% pass rate</p>
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
  const data = restTotal > 0 ? [...top, { label: 'Other', value: restTotal, passedValue: null }] : top
  const total = data.reduce((s, d) => s + d.value, 0)

  return (
    <div className="flex flex-col items-center gap-2 mt-2">
      <div className="relative w-40 h-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius="55%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
              {data.map((_, i) => <Cell key={i} fill={DONUT_PALETTE[i % DONUT_PALETTE.length]} />)}
            </Pie>
            <Tooltip content={<DonutTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Total</p>
            <p className="text-lg font-bold text-foreground">{total.toLocaleString()}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center max-w-full">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length] }} />
            <span className="text-[11px] text-muted-foreground truncate max-w-[100px]" title={d.label}>{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MiniTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div className="text-sm text-muted-foreground">—</div>
  const cols = Object.keys(rows[0]).slice(0, 5)
  return (
    <div className="overflow-x-auto mt-1">
      <table className="w-full text-xs">
        <thead><tr className="text-muted-foreground text-left">{cols.map(c => <th key={c} className="py-1 pr-4 font-medium capitalize">{c.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 10).map((r, i) => (
            <tr key={i} className="border-t border-border/40">{cols.map(c => <td key={c} className="py-1 pr-4 text-foreground">{fmt(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
