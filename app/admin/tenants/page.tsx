'use client'

import { useState, useEffect, useCallback } from 'react'
import { ShieldAlert, Search, Save, Loader2, Check, Plus, Pencil, PowerOff } from 'lucide-react'
import { DashboardHeader } from '@/components/DashboardHeader'
import { useAuthContext } from '@/components/AuthProvider'
import { useT } from '@/lib/lang-store'

type Kind = 'sale_exercises' | 'kpi' | 'exceltis_rest'

interface TenantListItem {
  tenantKey: string
  displayName: string
  kind: Kind
  url: string
  source: 'code' | 'admin'
  isActive?: boolean
  ucids?: number[]
}

interface DomainMapping {
  domain: string
  tenantKey: string
}

interface ProbeResult {
  kind: Kind | null
  confidence: 'high' | 'low'
  note: string
  rawSample: string
}

const emptyForm = {
  tenantKey: '',
  displayName: '',
  kind: 'sale_exercises' as Kind,
  url: '',
  xTenant: '',
  authHeaderName: '',
  authHeaderValue: '',
  ucidsText: '',
  domainsText: '',
  hasCertification: false,
  hasObjections: false,
  hasBusinessLines: false,
  hasOrganization: false,
  hasTopStats: false,
  coachActivityIdsText: '',
}

type FormState = typeof emptyForm

function parseIdList(text: string): number[] {
  return text
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => Number.isInteger(n))
}

function parseDomainList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

export default function AdminTenantsPage() {
  const t = useT()
  const { user, isLoading: authLoading } = useAuthContext()

  const [tenants, setTenants] = useState<TenantListItem[]>([])
  const [domains, setDomains] = useState<DomainMapping[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)

  const isAdmin = user?.role === 'admin'

  const loadTenants = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/admin/tenants', { credentials: 'include' })
      if (res.ok) {
        const json = await res.json()
        setTenants(json.data.tenants ?? [])
        setDomains(json.data.domains ?? [])
      }
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) loadTenants()
  }, [isAdmin, loadTenants])

  const domainsForTenant = useCallback(
    (key: string) => domains.filter(d => d.tenantKey === key).map(d => d.domain),
    [domains]
  )

  function resetForm() {
    setForm(emptyForm)
    setEditingKey(null)
    setProbeResult(null)
    setError(null)
    setSaved(false)
  }

  function startEdit(tenant: TenantListItem) {
    setForm({
      tenantKey: tenant.tenantKey,
      displayName: tenant.displayName,
      kind: tenant.kind,
      url: tenant.url,
      xTenant: '',
      authHeaderName: '',
      authHeaderValue: '',
      ucidsText: (tenant.ucids ?? []).join(', '),
      domainsText: domainsForTenant(tenant.tenantKey).join(', '),
      hasCertification: false,
      hasObjections: false,
      hasBusinessLines: false,
      hasOrganization: false,
      hasTopStats: false,
      coachActivityIdsText: '',
    })
    setEditingKey(tenant.tenantKey)
    setProbeResult(null)
    setError(null)
    setSaved(false)
  }

  async function handleProbe() {
    if (!form.url.trim()) return
    setProbing(true)
    setProbeResult(null)
    try {
      const res = await fetch('/api/admin/tenants/probe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url.trim(), xTenant: form.xTenant.trim() || undefined }),
      })
      const json = await res.json()
      if (res.ok) {
        const result: ProbeResult = json.data
        setProbeResult(result)
        if (result.kind) setForm(f => ({ ...f, kind: result.kind! }))
      } else {
        setError(json.data?.message ?? 'Probe failed')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProbing(false)
    }
  }

  async function handleSave() {
    setError(null)
    setSaved(false)

    const ucids = parseIdList(form.ucidsText)
    if (!form.tenantKey.trim() || !form.displayName.trim() || !form.url.trim() || ucids.length === 0) {
      setError(t.adminValidationError)
      return
    }

    setSaving(true)
    try {
      const body = {
        tenantKey: form.tenantKey.trim().toLowerCase(),
        displayName: form.displayName.trim(),
        kind: form.kind,
        url: form.url.trim(),
        xTenant: form.xTenant.trim() || undefined,
        authHeaderName: form.authHeaderName.trim() || undefined,
        authHeaderValue: form.authHeaderValue.trim() || undefined,
        ucids,
        hasCertification: form.hasCertification,
        hasObjections: form.hasObjections,
        hasBusinessLines: form.hasBusinessLines,
        hasOrganization: form.hasOrganization,
        hasTopStats: form.hasTopStats,
        coachActivityIds: parseIdList(form.coachActivityIdsText),
        domains: parseDomainList(form.domainsText),
      }

      const url = editingKey ? `/api/admin/tenants/${editingKey}` : '/api/admin/tenants'
      const method = editingKey ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.data?.message ?? 'Save failed')
        return
      }
      setSaved(true)
      resetForm()
      loadTenants()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(tenant: TenantListItem) {
    if (!confirm(t.adminDeactivateConfirm)) return
    await fetch(`/api/admin/tenants/${tenant.tenantKey}`, { method: 'DELETE', credentials: 'include' })
    loadTenants()
  }

  if (authLoading) {
    return <div className="min-h-screen w-full" />
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen w-full">
        <DashboardHeader title={t.adminTenantsTitle} subtitle={t.adminTenantsSub} />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-100 flex items-center justify-center mb-6">
            <ShieldAlert className="w-8 h-8 text-amber-600" />
          </div>
          <p className="text-sm text-muted-foreground max-w-md">{t.adminAccessRequired}</p>
        </div>
      </div>
    )
  }

  const inputCls =
    'w-full px-3 py-2 rounded-lg text-sm bg-background border border-border/60 focus:outline-none focus:ring-1 focus:ring-primary'
  const labelCls = 'text-sm font-semibold text-foreground mb-1 block'
  const hintCls = 'text-xs text-muted-foreground mt-1'

  return (
    <div className="min-h-screen w-full pb-16">
      <DashboardHeader title={t.adminTenantsTitle} subtitle={t.adminTenantsSub} />

      <div className="px-6 max-w-4xl mx-auto space-y-8 mt-6">
        {/* ── Form card ──────────────────────────────────────── */}
        <div className="rounded-[16px] border border-border/60 bg-card overflow-hidden">
          <div className="h-[3px] bg-gradient-to-r from-primary to-accent" />
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                {editingKey ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {editingKey ? editingKey : t.adminNewTenant}
              </h2>
              {editingKey && (
                <button onClick={resetForm} className="text-sm text-muted-foreground hover:text-foreground">
                  {t.adminCancelButton}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{t.adminFieldTenantKey}</label>
                <input
                  className={inputCls}
                  value={form.tenantKey}
                  disabled={!!editingKey}
                  onChange={e => setForm(f => ({ ...f, tenantKey: e.target.value.toLowerCase() }))}
                  placeholder="acme"
                />
                <p className={hintCls}>{t.adminFieldTenantKeyHint}</p>
              </div>
              <div>
                <label className={labelCls}>{t.adminFieldDisplayName}</label>
                <input
                  className={inputCls}
                  value={form.displayName}
                  onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                  placeholder="Acme Pharma"
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>{t.adminFieldEndpointUrl}</label>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={form.url}
                  onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://acme-server.example.com/bridge/"
                />
                <button
                  onClick={handleProbe}
                  disabled={probing || !form.url.trim()}
                  className="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold bg-muted hover:bg-muted/70 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {probing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {t.adminProbeButton}
                </button>
              </div>
              <p className={hintCls}>{t.adminFieldEndpointUrlHint}</p>
            </div>

            {probeResult && (
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2">
                <p className="text-sm font-semibold text-foreground">{t.adminProbeResult}</p>
                <p className={`text-xs ${probeResult.confidence === 'high' ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {probeResult.confidence === 'high' ? t.adminProbeConfidenceHigh : t.adminProbeConfidenceLow}
                </p>
                <p className="text-xs text-muted-foreground">{probeResult.note}</p>
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">{t.adminProbeSample}</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all bg-background rounded p-2 border border-border/40">
                    {probeResult.rawSample}
                  </pre>
                </details>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{t.adminFieldKind}</label>
                <select
                  className={inputCls}
                  value={form.kind}
                  onChange={e => setForm(f => ({ ...f, kind: e.target.value as Kind }))}
                >
                  <option value="sale_exercises">{t.adminKindSaleExercises}</option>
                  <option value="kpi">{t.adminKindKpi}</option>
                  <option value="exceltis_rest">{t.adminKindExceltisRest}</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{t.adminFieldXTenant}</label>
                <input
                  className={inputCls}
                  value={form.xTenant}
                  onChange={e => setForm(f => ({ ...f, xTenant: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>{t.adminFieldAuthHeaderName}</label>
                <input
                  className={inputCls}
                  value={form.authHeaderName}
                  onChange={e => setForm(f => ({ ...f, authHeaderName: e.target.value }))}
                  placeholder="X-Api-Key"
                />
              </div>
              <div>
                <label className={labelCls}>{t.adminFieldAuthHeaderValue}</label>
                <input
                  className={inputCls}
                  type="password"
                  value={form.authHeaderValue}
                  onChange={e => setForm(f => ({ ...f, authHeaderValue: e.target.value }))}
                />
              </div>
            </div>
            <p className={`${hintCls} -mt-2`}>{t.adminFieldAuthHint}</p>

            <div>
              <label className={labelCls}>{t.adminFieldExerciseIds}</label>
              <textarea
                className={`${inputCls} min-h-[80px]`}
                value={form.ucidsText}
                onChange={e => setForm(f => ({ ...f, ucidsText: e.target.value }))}
                placeholder="101, 102, 103"
              />
              <p className={hintCls}>{t.adminFieldExerciseIdsHint}</p>
            </div>

            <div>
              <label className={labelCls}>{t.adminFieldDomains}</label>
              <textarea
                className={`${inputCls} min-h-[60px]`}
                value={form.domainsText}
                onChange={e => setForm(f => ({ ...f, domainsText: e.target.value }))}
                placeholder="acme.com, acme.mx"
              />
              <p className={hintCls}>{t.adminFieldDomainsHint}</p>
            </div>

            <div>
              <label className={labelCls}>{t.adminFieldModules}</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  ['hasCertification', t.adminFieldCertification],
                  ['hasObjections', t.adminFieldObjections],
                  ['hasBusinessLines', t.adminFieldBusinessLines],
                  ['hasOrganization', t.adminFieldOrganization],
                  ['hasTopStats', t.adminFieldTopStats],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-foreground/90">
                    <input
                      type="checkbox"
                      checked={form[key as keyof FormState] as boolean}
                      onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))}
                      className="rounded border-border/60"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {form.kind === 'kpi' && (
              <div>
                <label className={labelCls}>{t.adminFieldCoachIds}</label>
                <input
                  className={inputCls}
                  value={form.coachActivityIdsText}
                  onChange={e => setForm(f => ({ ...f, coachActivityIdsText: e.target.value }))}
                  placeholder="8, 9, 10"
                />
                <p className={hintCls}>{t.adminFieldCoachIdsHint}</p>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && (
              <p className="text-sm text-emerald-600 flex items-center gap-1.5">
                <Check className="w-4 h-4" /> {t.adminSaved}
              </p>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? t.adminSaving : t.adminSaveButton}
            </button>
          </div>
        </div>

        {/* ── Existing tenants list ──────────────────────────── */}
        <div className="rounded-[16px] border border-border/60 bg-card overflow-hidden">
          <div className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground">{t.adminExistingTenants}</h2>
            {loadingList ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-muted" />)}
              </div>
            ) : tenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.adminNoTenantsYet}</p>
            ) : (
              <div className="divide-y divide-border/40">
                {tenants.map(tenant => (
                  <div key={tenant.tenantKey} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {tenant.displayName}{' '}
                        <span className="text-xs font-normal text-muted-foreground">({tenant.tenantKey})</span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{tenant.url}</p>
                      <p className="text-xs text-muted-foreground">
                        {domainsForTenant(tenant.tenantKey).join(', ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          tenant.source === 'admin'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {tenant.source === 'admin' ? t.adminSourceAdmin : t.adminSourceCode}
                      </span>
                      {tenant.source === 'admin' && (
                        <>
                          <button
                            onClick={() => startEdit(tenant)}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                            title={t.adminEditButton}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeactivate(tenant)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive/80 transition-colors"
                            title={t.adminDeactivateButton}
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
