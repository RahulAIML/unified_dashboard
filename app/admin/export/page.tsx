'use client'

/**
 * Internal/admin data export -- the "clear internal/admin export mechanism"
 * for raw, per-interaction dashboard data (not a client-facing feature).
 * Gated server-side by app/admin/layout.tsx exactly like /admin/users and
 * /admin/tenants; the actual CSV comes from GET /api/admin/export, which
 * re-checks requireAdminFromRequest independently.
 *
 * This page is a thin form over that endpoint: it builds the query string
 * and lets the browser's native download handling take it from there
 * (a plain <a href> to a Content-Disposition: attachment response), rather
 * than fetching + blob-downloading client-side -- simpler, and avoids
 * holding a large CSV in page memory.
 */

import { useState } from 'react'
import { DashboardHeader } from '@/components/DashboardHeader'

type Module = 'coach' | 'simulator' | 'certification' | 'other' | 'lms'

const MODULES: { value: Module; label: string; needsClientId: boolean; needsTenant: boolean }[] = [
  { value: 'lms',           label: 'LMS (LearnWorlds)',        needsClientId: false, needsTenant: true },
  { value: 'coach',         label: 'Master Coach',             needsClientId: true,  needsTenant: false },
  { value: 'simulator',     label: 'Simulator',                needsClientId: true,  needsTenant: false },
  { value: 'certification', label: 'Certification Coach',      needsClientId: true,  needsTenant: false },
  { value: 'other',         label: 'Other / unclassified',     needsClientId: true,  needsTenant: false },
]

export default function AdminExportPage() {
  const [module, setModule] = useState<Module>('lms')
  const [clientId, setClientId] = useState('')
  const [tenant, setTenant] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const cfg = MODULES.find(m => m.value === module)!
  const canBuild = cfg.needsClientId ? clientId.trim().length > 0 : !cfg.needsTenant || tenant.trim().length > 0

  function buildHref(): string {
    const params = new URLSearchParams({ module })
    if (cfg.needsClientId) params.set('clientId', clientId.trim())
    if (cfg.needsTenant) params.set('tenant', tenant.trim())
    if (!cfg.needsTenant) {
      if (from) params.set('from', new Date(from).toISOString())
      if (to) params.set('to', new Date(to).toISOString())
    }
    return `/api/admin/export?${params.toString()}`
  }

  return (
    <div className="min-h-screen w-full">
      <DashboardHeader title="Data Export" subtitle="Internal/admin only — raw per-interaction CSV export" />
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
          <p className="text-xs text-muted-foreground">
            Exports the real underlying rows behind the dashboard's KPIs — one row per session
            (or per LMS course-progress entry), including user identity, timestamps, scores, and the
            exact field the score was extracted from. Rolplay App SQL is the source for Master Coach,
            Simulator, Certification Coach, and unclassified activity; LMS uses LearnWorlds, since
            Rolplay App SQL has no LMS data of its own.
          </p>

          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block">Module</label>
            <select value={module} onChange={e => setModule(e.target.value as Module)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {cfg.needsClientId && (
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block">
                rolplay_app_sql client ID
              </label>
              <input value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="e.g. 24"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-xs text-muted-foreground mt-1">
                The numeric r_client.ID — the same id shown in the Dashboard Builder's company picker.
              </p>
            </div>
          )}

          {cfg.needsTenant && (
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block">Pharma tenant key</label>
              <input value={tenant} onChange={e => setTenant(e.target.value)}
                placeholder="e.g. apotex"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-xs text-muted-foreground mt-1">
                LMS is a current-state roster export (not date-filtered) — only tenants with a
                configured LearnWorlds school return real rows; others return an empty file.
              </p>
            </div>
          )}

          {!cfg.needsTenant && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-foreground mb-2 block">From (optional)</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-sm font-semibold text-foreground mb-2 block">To (optional)</label>
                <input type="date" value={to} onChange={e => setTo(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
            </div>
          )}

          <a
            href={canBuild ? buildHref() : undefined}
            aria-disabled={!canBuild}
            className={`inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              canBuild ? 'bg-primary text-primary-foreground hover:opacity-90' : 'bg-muted text-muted-foreground cursor-not-allowed pointer-events-none'
            }`}
          >
            Download CSV
          </a>
        </div>
      </div>
    </div>
  )
}
