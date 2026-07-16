'use client'

/**
 * Renders a dashboard purely from AI-service metadata + live widget data.
 * The same component powers the builder's preview and the published /d/[slug]
 * page — the frontend never has per-connector code; it draws whatever the
 * config describes. This is the "metadata over code generation" contract.
 */

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

export function MiniChart({ series, bar }: { series: Record<string, unknown>[]; bar?: boolean }) {
  const rows = series.slice(0, 14)
  const vals = rows.map(r => Number(r.value ?? r.total_sessions ?? r.sessions ?? 0))
  const max = Math.max(1, ...vals)
  return (
    <div className="flex items-end gap-1 h-24 mt-2">
      {rows.map((r, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end" title={`${r.date ?? r.activity ?? r.usecase ?? i}: ${vals[i]}`}>
          <div className={`w-full rounded-t ${bar ? 'bg-primary/70' : 'bg-primary'}`} style={{ height: `${Math.max(4, (vals[i] / max) * 90)}%` }} />
        </div>
      ))}
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
