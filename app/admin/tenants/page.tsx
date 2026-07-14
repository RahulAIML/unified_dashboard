'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  ShieldAlert, Search, Save, Loader2, Check, Plus, Pencil, PowerOff,
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, X, Building2,
  Cable, Database, LayoutGrid, ClipboardCheck,
} from 'lucide-react'
import { DashboardHeader } from '@/components/DashboardHeader'
import { useAuthContext } from '@/components/AuthProvider'
import { useT } from '@/lib/lang-store'
import { cn } from '@/lib/utils'

type Kind = 'sale_exercises' | 'kpi' | 'exceltis_rest'

interface TenantListItem {
  tenantKey: string
  displayName: string
  kind: Kind
  url: string
  source: 'code' | 'admin'
  isActive?: boolean
  ucids?: number[]
  xTenant?: string | null
  hasCertification?: boolean
  hasObjections?: boolean
  hasBusinessLines?: boolean
  hasOrganization?: boolean
  hasTopStats?: boolean
  coachActivityIds?: number[] | null
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
type FieldErrors = Partial<Record<keyof FormState, string>>

const STEP_COUNT = 5 // basics, connection, data, modules, review

function parseIdList(text: string): number[] {
  return text.split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(Number).filter(n => Number.isInteger(n))
}
function hasNonIntegerToken(text: string): boolean {
  return text.split(/[,\n]/).map(s => s.trim()).filter(Boolean).some(tok => !Number.isInteger(Number(tok)))
}
function parseDomainList(text: string): string[] {
  return text.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean)
}
function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// ── Presentational helpers (module-level to preserve input focus) ─────────────

const INPUT_BASE =
  'w-full px-3 py-2 rounded-lg text-sm bg-muted border transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground'

function Field({
  id, label, hint, error, children,
}: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-foreground mb-1 block">{label}</label>
      {children}
      {error
        ? <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3 shrink-0" />{error}</p>
        : hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  )
}

function Stepper({ step, labels }: { step: number; labels: string[] }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {labels.map((label, i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'todo'
        return (
          <div key={label} className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  'flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0 transition-colors',
                  state === 'done' && 'bg-primary text-primary-foreground',
                  state === 'current' && 'bg-primary/15 text-primary ring-1 ring-primary',
                  state === 'todo' && 'bg-muted text-muted-foreground',
                )}
              >
                {state === 'done' ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </span>
              <span className={cn(
                'text-xs font-medium truncate hidden md:block',
                state === 'current' ? 'text-foreground' : 'text-muted-foreground',
              )}>{label}</span>
            </div>
            {i < labels.length - 1 && (
              <div className={cn('h-px w-3 sm:w-6 shrink-0', i < step ? 'bg-primary' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function AdminTenantsPage() {
  const t = useT()
  const { user, isLoading: authLoading } = useAuthContext()

  const [tenants, setTenants] = useState<TenantListItem[]>([])
  const [domains, setDomains] = useState<DomainMapping[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [step, setStep] = useState(0)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<TenantListItem | null>(null)

  const isAdmin = user?.role === 'admin'

  const stepLabels = [
    t.adminStepBasics, t.adminStepConnection, t.adminStepData, t.adminStepModules, t.adminStepReview,
  ]
  const stepSubs = [
    t.adminStepBasicsSub, t.adminStepConnectionSub, t.adminStepDataSub, t.adminStepModulesSub, t.adminStepReviewSub,
  ]
  const stepIcons = [Building2, Cable, Database, LayoutGrid, ClipboardCheck]
  const StepIcon = stepIcons[step]

  const existingKeys = useMemo(() => new Set(tenants.map(t => t.tenantKey.toLowerCase())), [tenants])

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

  useEffect(() => { if (isAdmin) loadTenants() }, [isAdmin, loadTenants])

  const domainsForTenant = useCallback(
    (key: string) => domains.filter(d => d.tenantKey === key).map(d => d.domain),
    [domains]
  )

  function resetForm() {
    setForm(emptyForm); setEditingKey(null); setProbeResult(null)
    setErrors({}); setError(null); setSaved(null); setStep(0)
  }

  function startEdit(tenant: TenantListItem) {
    setForm({
      tenantKey: tenant.tenantKey,
      displayName: tenant.displayName,
      kind: tenant.kind,
      url: tenant.url,
      xTenant: tenant.xTenant ?? '',
      authHeaderName: '',
      authHeaderValue: '',
      ucidsText: (tenant.ucids ?? []).join(', '),
      domainsText: domainsForTenant(tenant.tenantKey).join(', '),
      hasCertification: !!tenant.hasCertification,
      hasObjections: !!tenant.hasObjections,
      hasBusinessLines: !!tenant.hasBusinessLines,
      hasOrganization: !!tenant.hasOrganization,
      hasTopStats: !!tenant.hasTopStats,
      coachActivityIdsText: (tenant.coachActivityIds ?? []).join(', '),
    })
    setEditingKey(tenant.tenantKey)
    setProbeResult(null); setErrors({}); setError(null); setSaved(null); setStep(0)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }))
  }

  function validateStep(s: number): FieldErrors {
    const e: FieldErrors = {}
    if (s === 0) {
      const key = form.tenantKey.trim().toLowerCase()
      if (!key) e.tenantKey = t.adminErrTenantKeyRequired
      else if (!/^[a-z0-9_-]+$/.test(key)) e.tenantKey = t.adminErrTenantKeyFormat
      else if (!editingKey && existingKeys.has(key)) e.tenantKey = t.adminErrTenantKeyDup
      if (!form.displayName.trim()) e.displayName = t.adminErrNameRequired
    }
    if (s === 1) {
      if (!form.url.trim()) e.url = t.adminErrUrlRequired
      else if (!isValidUrl(form.url)) e.url = t.adminErrUrlFormat
    }
    if (s === 2) {
      if (hasNonIntegerToken(form.ucidsText)) e.ucidsText = t.adminErrIdsFormat
      else if (parseIdList(form.ucidsText).length === 0) e.ucidsText = t.adminErrNoIds
    }
    return e
  }

  function goNext() {
    const e = validateStep(step)
    if (Object.values(e).some(Boolean)) { setErrors(e); return }
    setErrors({}); setStep(s => Math.min(s + 1, STEP_COUNT - 1))
  }
  function goBack() { setErrors({}); setStep(s => Math.max(s - 1, 0)) }

  async function handleProbe() {
    if (!form.url.trim()) return
    setProbing(true); setProbeResult(null)
    try {
      const res = await fetch('/api/admin/tenants/probe', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: form.url.trim(), xTenant: form.xTenant.trim() || undefined }),
      })
      const json = await res.json()
      if (res.ok) {
        const result: ProbeResult = json.data
        setProbeResult(result)
        if (result.kind) set('kind', result.kind)
      } else setError(json.data?.message ?? 'Probe failed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setProbing(false)
    }
  }

  async function handleSave() {
    // Re-validate every gated step before committing.
    for (let s = 0; s <= 2; s++) {
      const e = validateStep(s)
      if (Object.values(e).some(Boolean)) { setErrors(e); setStep(s); return }
    }
    setError(null); setSaved(null); setSaving(true)
    try {
      const body = {
        tenantKey: form.tenantKey.trim().toLowerCase(),
        displayName: form.displayName.trim(),
        kind: form.kind,
        url: form.url.trim(),
        xTenant: form.xTenant.trim() || undefined,
        authHeaderName: form.authHeaderName.trim() || undefined,
        authHeaderValue: form.authHeaderValue.trim() || undefined,
        ucids: parseIdList(form.ucidsText),
        hasCertification: form.hasCertification,
        hasObjections: form.hasObjections,
        hasBusinessLines: form.hasBusinessLines,
        hasOrganization: form.hasOrganization,
        hasTopStats: form.hasTopStats,
        coachActivityIds: parseIdList(form.coachActivityIdsText),
        domains: parseDomainList(form.domainsText),
      }
      const url = editingKey ? `/api/admin/tenants/${editingKey}` : '/api/admin/tenants'
      const res = await fetch(url, {
        method: editingKey ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.data?.message ?? 'Save failed'); return }
      setSaved(editingKey ? t.adminUpdatedMsg : t.adminSaved)
      resetForm()
      loadTenants()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return
    await fetch(`/api/admin/tenants/${deactivateTarget.tenantKey}`, { method: 'DELETE', credentials: 'include' })
    setDeactivateTarget(null)
    loadTenants()
  }

  if (authLoading) return <div className="min-h-screen w-full" />

  if (!isAdmin) {
    return (
      <div className="min-h-screen w-full">
        <DashboardHeader title={t.adminTenantsTitle} subtitle={t.adminTenantsSub} />
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-6">
            <ShieldAlert className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground max-w-md">{t.adminAccessRequired}</p>
        </div>
      </div>
    )
  }

  const inputErrCls = (k: keyof FormState) => cn(INPUT_BASE, errors[k] ? 'border-destructive ring-1 ring-destructive/30' : 'border-border/60')

  return (
    <div className="min-h-screen w-full pb-16">
      <DashboardHeader title={t.adminTenantsTitle} subtitle={t.adminTenantsSub} />

      <div className="px-4 sm:px-6 max-w-4xl mx-auto space-y-8 mt-6">
        {/* ── Wizard card ─────────────────────────────────────── */}
        <div className="rounded-[16px] border border-border/60 bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="h-[3px] bg-gradient-to-r from-primary to-accent" />
          <div className="p-5 sm:p-6 space-y-6">
            {/* Header row: title + stepper + cancel */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2 min-w-0">
                  {editingKey ? <Pencil className="w-4 h-4 shrink-0" /> : <Plus className="w-4 h-4 shrink-0" />}
                  <span className="truncate">{editingKey ?? t.adminNewTenant}</span>
                </h2>
                {editingKey && (
                  <button onClick={resetForm} className="text-sm text-muted-foreground hover:text-foreground shrink-0">
                    {t.adminCancelButton}
                  </button>
                )}
              </div>
              <Stepper step={step} labels={stepLabels} />
            </div>

            {/* Step heading */}
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <StepIcon className="w-[18px] h-[18px]" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t.adminStepLabel} {step + 1} {t.adminStepOfLabel} {STEP_COUNT}
                </p>
                <p className="text-sm text-foreground mt-0.5">{stepSubs[step]}</p>
              </div>
            </div>

            {/* ── Step content ─────────────────────────────────── */}
            {step === 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field id="tenantKey" label={t.adminFieldTenantKey} hint={t.adminFieldTenantKeyHint} error={errors.tenantKey}>
                  <input id="tenantKey" className={inputErrCls('tenantKey')} value={form.tenantKey} disabled={!!editingKey}
                    aria-invalid={!!errors.tenantKey}
                    onChange={e => set('tenantKey', e.target.value.toLowerCase())} placeholder="acme" />
                </Field>
                <Field id="displayName" label={t.adminFieldDisplayName} error={errors.displayName}>
                  <input id="displayName" className={inputErrCls('displayName')} value={form.displayName}
                    aria-invalid={!!errors.displayName}
                    onChange={e => set('displayName', e.target.value)} placeholder="Acme Pharma" />
                </Field>
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <Field id="url" label={t.adminFieldEndpointUrl} hint={t.adminFieldEndpointUrlHint} error={errors.url}>
                  <div className="flex gap-2">
                    <input id="url" className={inputErrCls('url')} value={form.url}
                      aria-invalid={!!errors.url}
                      onChange={e => set('url', e.target.value)} placeholder="https://acme-server.example.com/bridge/" />
                    <button onClick={handleProbe} disabled={probing || !form.url.trim()}
                      aria-label={t.adminProbeButton}
                      className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-border bg-card hover:bg-muted transition-colors disabled:opacity-50">
                      {probing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      <span className="hidden sm:inline">{t.adminProbeButton}</span>
                    </button>
                  </div>
                </Field>

                {probing && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />{t.adminProbing}</p>}

                {probeResult && (
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-4 space-y-2">
                    <p className="text-sm font-semibold text-foreground">{t.adminProbeResult}</p>
                    <p className={cn('text-xs font-medium', probeResult.confidence === 'high' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      {probeResult.confidence === 'high' ? t.adminProbeConfidenceHigh : t.adminProbeConfidenceLow}
                    </p>
                    <p className="text-xs text-muted-foreground">{probeResult.note}</p>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">{t.adminProbeSample}</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-all bg-background rounded p-2 border border-border/40 max-h-40 overflow-y-auto">{probeResult.rawSample}</pre>
                    </details>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="kind" label={t.adminFieldKind}>
                    <select id="kind" className={cn(INPUT_BASE, 'border-border/60')} value={form.kind}
                      onChange={e => set('kind', e.target.value as Kind)}>
                      <option value="sale_exercises">{t.adminKindSaleExercises}</option>
                      <option value="kpi">{t.adminKindKpi}</option>
                      <option value="exceltis_rest">{t.adminKindExceltisRest}</option>
                    </select>
                  </Field>
                  <Field id="xTenant" label={t.adminFieldXTenant}>
                    <input id="xTenant" className={cn(INPUT_BASE, 'border-border/60')} value={form.xTenant}
                      onChange={e => set('xTenant', e.target.value)} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field id="authHeaderName" label={t.adminFieldAuthHeaderName}>
                    <input id="authHeaderName" className={cn(INPUT_BASE, 'border-border/60')} value={form.authHeaderName}
                      onChange={e => set('authHeaderName', e.target.value)} placeholder="X-Api-Key" />
                  </Field>
                  <Field id="authHeaderValue" label={t.adminFieldAuthHeaderValue} hint={t.adminFieldAuthHint}>
                    <input id="authHeaderValue" type="password" className={cn(INPUT_BASE, 'border-border/60')} value={form.authHeaderValue}
                      onChange={e => set('authHeaderValue', e.target.value)} />
                  </Field>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <Field id="ucidsText" label={t.adminFieldExerciseIds} hint={t.adminFieldExerciseIdsHint} error={errors.ucidsText}>
                  <textarea id="ucidsText" className={cn(inputErrCls('ucidsText'), 'min-h-[80px]')} value={form.ucidsText}
                    aria-invalid={!!errors.ucidsText}
                    onChange={e => set('ucidsText', e.target.value)} placeholder="101, 102, 103" />
                </Field>
                <Field id="domainsText" label={t.adminFieldDomains} hint={t.adminFieldDomainsHint}>
                  <textarea id="domainsText" className={cn(INPUT_BASE, 'border-border/60 min-h-[60px]')} value={form.domainsText}
                    onChange={e => set('domainsText', e.target.value)} placeholder="acme.com, acme.mx" />
                </Field>
                {form.kind === 'kpi' && (
                  <Field id="coachActivityIdsText" label={t.adminFieldCoachIds} hint={t.adminFieldCoachIdsHint}>
                    <input id="coachActivityIdsText" className={cn(INPUT_BASE, 'border-border/60')} value={form.coachActivityIdsText}
                      onChange={e => set('coachActivityIdsText', e.target.value)} placeholder="8, 9, 10" />
                  </Field>
                )}
              </div>
            )}

            {step === 3 && (
              <div>
                <p className="text-sm font-semibold text-foreground mb-3">{t.adminFieldModules}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    ['hasCertification', t.adminFieldCertification],
                    ['hasObjections', t.adminFieldObjections],
                    ['hasBusinessLines', t.adminFieldBusinessLines],
                    ['hasOrganization', t.adminFieldOrganization],
                    ['hasTopStats', t.adminFieldTopStats],
                  ] as const).map(([key, label]) => {
                    const checked = form[key] as boolean
                    return (
                      <label key={key} htmlFor={key}
                        className={cn(
                          'flex items-center gap-3 text-sm rounded-lg border p-3 cursor-pointer transition-colors',
                          checked ? 'border-primary bg-primary/5 text-foreground' : 'border-border/60 hover:bg-muted text-foreground/90',
                        )}>
                        <input id={key} type="checkbox" checked={checked}
                          onChange={e => set(key, e.target.checked)}
                          className="rounded border-border/60 accent-[hsl(var(--primary))]" />
                        {label}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}

            {step === 4 && (
              <ReviewStep t={t} form={form} />
            )}

            {/* ── Feedback banners ─────────────────────────────── */}
            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* ── Navigation ───────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <button onClick={goBack} disabled={step === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold border border-border bg-card hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none">
                <ChevronLeft className="w-4 h-4" /> {t.adminBackButton}
              </button>
              {step < STEP_COUNT - 1 ? (
                <button onClick={goNext}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                  {t.adminNextButton} <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button onClick={handleSave} disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? t.adminSaving : t.adminSaveButton}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Success toast (post-save) ───────────────────────── */}
        {saved && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <p className="text-sm text-emerald-700 dark:text-emerald-300">{saved}</p>
          </div>
        )}

        {/* ── Registered clients list ─────────────────────────── */}
        <div className="rounded-[16px] border border-border/60 bg-card overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="p-5 sm:p-6 space-y-4">
            <h2 className="text-lg font-bold text-foreground">{t.adminExistingTenants}</h2>
            {loadingList ? (
              <div className="animate-pulse space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-14 rounded-lg bg-muted" />)}
              </div>
            ) : tenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.adminNoTenantsYet}</p>
            ) : (
              <div className="divide-y divide-border/40">
                {tenants.map(tenant => {
                  const inactive = tenant.source === 'admin' && tenant.isActive === false
                  return (
                    <div key={tenant.tenantKey} className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
                          {tenant.displayName}
                          <span className="text-xs font-normal text-muted-foreground">({tenant.tenantKey})</span>
                          {inactive && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                              {t.adminInactiveLabel}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{tenant.url}</p>
                        {domainsForTenant(tenant.tenantKey).length > 0 && (
                          <p className="text-xs text-muted-foreground truncate">{domainsForTenant(tenant.tenantKey).join(', ')}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full font-medium',
                          tenant.source === 'admin'
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground',
                        )}>
                          {tenant.source === 'admin' ? t.adminSourceAdmin : t.adminSourceCode}
                        </span>
                        {tenant.source === 'admin' && (
                          <>
                            <button onClick={() => startEdit(tenant)} aria-label={`${t.adminEditButton} ${tenant.displayName}`}
                              className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {!inactive && (
                              <button onClick={() => setDeactivateTarget(tenant)} aria-label={`${t.adminDeactivateButton} ${tenant.displayName}`}
                                className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive/80 transition-colors">
                                <PowerOff className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Deactivate confirmation modal ─────────────────────── */}
      {deactivateTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true"
          onClick={() => setDeactivateTarget(null)}>
          <div className="w-full max-w-sm rounded-[16px] border border-border/60 bg-card shadow-xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
                  <PowerOff className="w-5 h-5 text-destructive" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">{t.adminDeactivateTitle}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t.adminDeactivateConfirm}</p>
                </div>
                <button onClick={() => setDeactivateTarget(null)} aria-label={t.adminCancelButton}
                  className="ml-auto p-1 rounded-lg hover:bg-muted transition-colors shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setDeactivateTarget(null)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold border border-border bg-card hover:bg-muted transition-colors">
                  {t.adminCancelButton}
                </button>
                <button onClick={confirmDeactivate}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-destructive text-white hover:bg-destructive/90 transition-colors">
                  {t.adminConfirmDeactivate}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Review step ───────────────────────────────────────────────────────────────

function ReviewStep({ t, form }: { t: ReturnType<typeof useT>; form: FormState }) {
  const domains = parseDomainList(form.domainsText)
  const ids = parseIdList(form.ucidsText)
  const kindLabel = form.kind === 'sale_exercises' ? t.adminKindSaleExercises
    : form.kind === 'kpi' ? t.adminKindKpi : t.adminKindExceltisRest
  const modules = [
    form.hasCertification && t.adminFieldCertification,
    form.hasObjections && t.adminFieldObjections,
    form.hasBusinessLines && t.adminFieldBusinessLines,
    form.hasOrganization && t.adminFieldOrganization,
    form.hasTopStats && t.adminFieldTopStats,
  ].filter(Boolean) as string[]

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-all">{value || t.adminReviewFieldValue}</span>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-1">
        <Row label={t.adminFieldDisplayName} value={`${form.displayName} (${form.tenantKey})`} />
        <Row label={t.adminFieldEndpointUrl} value={form.url} />
        <Row label={t.adminFieldKind} value={kindLabel} />
        <Row label={t.adminFieldExerciseIds} value={ids.join(', ')} />
        <Row label={t.adminFieldDomains} value={domains.join(', ')} />
        <Row label={t.adminFieldModules} value={modules.length ? modules.join(', ') : t.adminReviewModulesNone} />
      </div>
      {domains.length === 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700 dark:text-amber-300">{t.adminReviewNoDomains}</p>
        </div>
      )}
    </div>
  )
}
