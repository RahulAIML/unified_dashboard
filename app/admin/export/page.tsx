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
import { useT } from '@/lib/lang-store'

type Module = 'coach' | 'simulator' | 'certification' | 'other' | 'lms'

export default function AdminExportPage() {
  const t = useT()
  const MODULES: { value: Module; label: string; needsClientId: boolean; needsTenant: boolean }[] = [
    { value: 'lms',           label: t.adminExportModuleLms,           needsClientId: false, needsTenant: true },
    { value: 'coach',         label: t.adminExportModuleCoach,         needsClientId: true,  needsTenant: false },
    { value: 'simulator',     label: t.adminExportModuleSimulator,     needsClientId: true,  needsTenant: false },
    { value: 'certification', label: t.adminExportModuleCertification, needsClientId: true,  needsTenant: false },
    { value: 'other',         label: t.adminExportModuleOther,         needsClientId: true,  needsTenant: false },
  ]
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
      <DashboardHeader title={t.adminExportTitle} subtitle={t.adminExportSubtitle} />
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-5">
          <p className="text-xs text-muted-foreground">
            {t.adminExportDesc}
          </p>

          <div>
            <label className="text-sm font-semibold text-foreground mb-2 block">{t.adminExportModuleLabel}</label>
            <select value={module} onChange={e => setModule(e.target.value as Module)}
              className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
              {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {cfg.needsClientId && (
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block">
                {t.adminExportClientIdLabel}
              </label>
              <input value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="e.g. 24"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-xs text-muted-foreground mt-1">
                {t.adminExportClientIdHint}
              </p>
            </div>
          )}

          {cfg.needsTenant && (
            <div>
              <label className="text-sm font-semibold text-foreground mb-2 block">{t.adminExportTenantLabel}</label>
              <input value={tenant} onChange={e => setTenant(e.target.value)}
                placeholder="e.g. apotex"
                className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-xs text-muted-foreground mt-1">
                {t.adminExportTenantHint}
              </p>
            </div>
          )}

          {!cfg.needsTenant && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-foreground mb-2 block">{t.adminExportFromLabel}</label>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>
              <div>
                <label className="text-sm font-semibold text-foreground mb-2 block">{t.adminExportToLabel}</label>
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
            {t.adminExportDownloadBtn}
          </a>
        </div>
      </div>
    </div>
  )
}
