'use client'

/**
 * Renders a dashboard purely from AI-service metadata + live widget data.
 * The same component powers the builder's preview and the published /d/[slug]
 * page — the frontend never has per-connector code; it draws whatever the
 * config describes. This is the "metadata over code generation" contract.
 */

import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LabelList,
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
              const wide = w.type === 'table' || w.type === 'line_chart' || w.type === 'bar_chart'
              return (
                <div key={w.id} className={`rounded-xl border border-border/60 bg-background p-4 ${wide ? 'col-span-2 md:col-span-4' : ''}`}>
                  <div className="text-xs text-muted-foreground mb-1">{w.title}</div>
                  {w.type === 'kpi_tile' && <div className="text-2xl font-bold text-foreground">{fmt(p?.value)}</div>}
                  {(w.type === 'line_chart' || w.type === 'bar_chart') && <MiniChart series={p?.series ?? p?.rows ?? []} bar={w.type === 'bar_chart'} />}
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

function normalizeChartRow(r: Record<string, unknown>, i: number): { label: string; value: number } {
  const rawLabel = r.date ?? r.activity ?? r.usecase ?? r.simulator ?? i
  return {
    label: String(rawLabel),
    value: Number(r.value ?? r.total_sessions ?? r.sessions ?? 0),
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

  return (
    <div className="w-full h-40 mt-2">
      <ResponsiveContainer width="100%" height="100%">
        {bar ? (
          <BarChart data={data} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="currentColor" strokeOpacity={0.06} vertical={false} />
            <XAxis dataKey="label" tickFormatter={truncateTick} tick={tickProps} axisLine={false} tickLine={false} dy={6} />
            <YAxis tick={tickProps} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'currentColor', opacity: 0.05 }} />
            <Bar dataKey="value" fill="var(--chart-1, hsl(var(--primary)))" radius={[4, 4, 0, 0]} maxBarSize={56}>
              {/* Always-visible label so a tiny bar (e.g. 3 sessions next to
                  129) still shows its real number instead of reading as an
                  unlabeled sliver indistinguishable from zero. */}
              <LabelList dataKey="value" position="top" style={{ fontSize: 11, fill: 'currentColor', opacity: 0.7 }} />
            </Bar>
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
