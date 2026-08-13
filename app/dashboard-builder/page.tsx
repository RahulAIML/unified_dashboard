'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthContext } from '@/components/AuthProvider'
import { DashboardRenderer, humanizeConnector } from '@/components/DashboardRenderer'

// ── Types mirroring the AI service JobState ─────────────────────────────────────
type Phase =
  | 'queued' | 'planning' | 'company_discovery' | 'service_discovery'
  | 'needs_ids' | 'schema_discovery' | 'review_services'
  | 'dashboard_planning' | 'dashboard_config'
  | 'validation' | 'preview' | 'publish' | 'done' | 'error'

interface JobLog { ts: string; phase: Phase; level: 'info' | 'warn' | 'error' | 'success'; message: string }
interface WidgetPreview { widget_id: string; ok: boolean; value?: number | string | null; series?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; error?: string | null }
interface WidgetConfig {
  id: string; type: string; title: string; metric_key?: string | null; span?: number
  id_field?: string | null; business_question?: string | null
  paginated?: boolean; searchable?: boolean; exportable?: boolean
}
interface DashRow { id: string; title?: string | null; widgets: WidgetConfig[] }
interface DashPage { id: string; title: string; rows: DashRow[] }
interface DashboardConfig { company: string; slug: string; title: string; connector: string; rows: DashRow[]; pages?: DashPage[]; recommendations: string[]; insights?: string[] }
interface ValidationIssue { severity: 'error' | 'warning' | 'info'; code: string; message: string }
interface ValidationReport { ok: boolean; issues: ValidationIssue[]; summary: string }
interface JobState {
  job_id: string; phase: Phase; percent: number; logs: JobLog[]
  dashboard?: DashboardConfig | null; validation?: ValidationReport | null
  preview?: { widgets: WidgetPreview[] } | null; published?: boolean; error?: string | null
  pending_connector?: string | null
  available_modules?: string[]
}

const PHASE_STEPS: { key: Phase; label: string }[] = [
  { key: 'planning', label: 'Plan' },
  { key: 'company_discovery', label: 'Locate company' },
  { key: 'service_discovery', label: 'Discover services' },
  { key: 'schema_discovery', label: 'Understand schema' },
  { key: 'dashboard_planning', label: 'Design dashboard' },
  { key: 'validation', label: 'Validate' },
  { key: 'preview', label: 'Preview' },
  { key: 'done', label: 'Ready' },
]
const ORDER = PHASE_STEPS.map(s => s.key)

// Step 1 options. Labels match the dashboard's own module naming.
const SERVICE_OPTIONS: { id: string; label: string }[] = [
  { id: 'simulator',     label: 'Simulator'       },
  { id: 'coach',         label: 'Master Coach'    },
  { id: 'certification', label: 'Certifier Coach' },
  { id: 'lms',           label: 'LMS'             },
  { id: 'second-brain',  label: 'Second Brain'    },
]

interface KnownCompany { id: number; name: string; sessions: number; users: number }

/**
 * Client-side admin gate. Defence-in-depth only — layout.tsx is the real
 * boundary and redirects non-admins server-side before this ever renders.
 *
 * The gate has to live in its own component: auth starts out `isLoading` and
 * then resolves, so an early return here followed by the builder's own hooks
 * would change the hook count between those two renders, which React rejects
 * ("Rendered more hooks than during the previous render"). Keeping the hooks
 * in a child that only mounts once access is granted sidesteps that entirely.
 */
export default function DashboardBuilderPage() {
  const { user, isLoading } = useAuthContext()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h1>
          <p className="text-gray-600 mb-6">
            Only administrators can access the Dashboard Builder.
            {!user && ' Please log in to continue.'}
          </p>
          <a
            href={user ? '/' : '/auth/login'}
            className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            {user ? 'Back to Dashboard' : 'Go to Login'}
          </a>
        </div>
      </div>
    )
  }

  return <DashboardBuilder />
}

function DashboardBuilder() {
  const [company, setCompany] = useState('')
  // Populates a <datalist> so a manager can pick an existing rolplay_app_sql
  // client instead of retyping/misspelling its name — free-text entry still
  // works for anything not in this list (a brand-new client, or any other
  // connector). rolplay_app_sql only, per the user's own request.
  const [knownCompanies, setKnownCompanies] = useState<KnownCompany[]>([])
  useEffect(() => {
    fetch('/api/ai/known-companies', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : [])
      .then((rows: KnownCompany[]) => setKnownCompanies(Array.isArray(rows) ? rows : []))
      .catch(() => { /* picker is a convenience — free text still works */ })
  }, [])
  const [domainText, setDomainText] = useState('')
  // Step 1 — services the manager knows for CERTAIN this client is
  // contracted for. Defaults to none selected: checking a box is now an
  // affirmative "always show this section, even with no data yet" (see
  // ai-service's mandatory_empty_page) -- ticking every box "to be safe"
  // would fill every dashboard with empty placeholder tabs for services the
  // tenant may not even want, so this must never be a rushed default.
  // Anything left unchecked still appears automatically the moment real
  // data is discovered for it -- unchecked only means "don't force it".
  const [services, setServices] = useState<Set<string>>(() => new Set())
  const toggleService = (id: string) =>
    setServices(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  const [idsText, setIdsText] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [confidential, setConfidential] = useState(false)
  const [job, setJob] = useState<JobState | null>(null)
  const [starting, setStarting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [pendingIdsText, setPendingIdsText] = useState('')
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set())
  const [resuming, setResuming] = useState(false)
  const [copied, setCopied] = useState(false)
  const [acknowledgedEmpty, setAcknowledgedEmpty] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null)
  const seededModulesFor = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  const stopPoll = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  useEffect(() => () => stopPoll(), [])
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [job?.logs.length])

  const poll = useCallback((jobId: string) => {
    stopPoll()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/ai/status/${jobId}`, { cache: 'no-store' })
        if (!res.ok) return
        const j: JobState = await res.json()
        setJob(j)
        // Pause polling while waiting on a manager decision — resumed by
        // provideIds()/confirmServices() after they call the resume endpoint.
        if (j.phase === 'done' || j.phase === 'error' || j.phase === 'needs_ids' || j.phase === 'review_services') {
          stopPoll()
        }
      } catch { /* keep polling */ }
    }, 1000)
  }, [])

  // Pre-check every discovered module the first time review_services appears
  // for this job — the manager deselects what they DON'T want, never picks blind.
  useEffect(() => {
    if (job?.phase === 'review_services' && job.available_modules && seededModulesFor.current !== job.job_id) {
      setSelectedModules(new Set(job.available_modules))
      seededModulesFor.current = job.job_id
    }
  }, [job])

  async function provideIds() {
    if (!job) return
    const exercise_ids = pendingIdsText.split(/[,\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n))
    if (exercise_ids.length === 0) return
    setResuming(true)
    try {
      const res = await fetch('/api/ai/provide-ids', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, exercise_ids }),
      })
      const j: JobState = await res.json()
      setJob(j); setPendingIdsText(''); poll(j.job_id)
    } finally { setResuming(false) }
  }

  async function confirmServices() {
    if (!job) return
    setResuming(true)
    try {
      const res = await fetch('/api/ai/confirm-services', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, modules: Array.from(selectedModules) }),
      })
      const j: JobState = await res.json()
      setJob(j); poll(j.job_id)
    } finally { setResuming(false) }
  }

  function toggleModule(m: string) {
    setSelectedModules(prev => {
      const next = new Set(prev)
      if (next.has(m)) next.delete(m); else next.add(m)
      return next
    })
  }

  async function generate() {
    if (!company.trim()) return
    setStarting(true); setJob(null)
    const exercise_ids = idsText.split(/[,\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n))
    const domains = domainText.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
    try {
      const res = await fetch('/api/ai/generate-dashboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: company.trim(), exercise_ids, domains, services: Array.from(services), confidential }),
      })
      const j: JobState = await res.json()
      setJob(j); poll(j.job_id)
    } finally { setStarting(false) }
  }

  async function publish() {
    if (!job) return
    setPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch('/api/ai/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'Publish failed' }))
        throw new Error(payload.error || 'Publish failed')
      }
      const r = await res.json()
      setJob(prev => prev ? { ...prev, published: !!r.published } : prev)
      if (r.published && r.slug) {
        setPublishedSlug(r.slug)
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed')
    } finally { setPublishing(false) }
  }

  function requestTemplate(): string {
    return `Hi — we're setting up an analytics dashboard for ${company || 'our company'} and need one piece of info from you.\n\nCould you send us the list of "exercise" or "use case" IDs (numbers) used in our training platform? These identify each training scenario in the system. Once we have that list, the dashboard can go live.\n\nThanks!`
  }
  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(requestTemplate())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable — silently ignore */ }
  }

  const PAUSED_PHASES: Phase[] = ['needs_ids', 'review_services']
  const isPaused = !!job && PAUSED_PHASES.includes(job.phase)
  const running = !!job && job.phase !== 'done' && job.phase !== 'error' && !isPaused
  const stepForOrder = (p: Phase): Phase =>
    p === 'dashboard_config' ? 'dashboard_planning' : p === 'needs_ids' ? 'service_discovery' : p === 'review_services' ? 'schema_discovery' : p
  const currentIdx = job ? ORDER.indexOf(stepForOrder(job.phase)) : -1

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Build your dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Type your company name and press <span className="font-semibold text-foreground">Generate</span>.
          Our AI finds your data, builds the dashboard, and shows you a live preview. No setup, no code.
        </p>
      </header>

      {/* Input card — company name is the only thing a manager needs */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        {/* Step 1 — contracted services. Off by default: this now controls
            whether a section is FORCED to appear (mandatory, honest empty
            state) even with no data -- not just a soft hint. */}
        <label className="text-sm font-semibold text-foreground mb-2 block">
          Is this client definitely contracted for any of these? (optional)
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {SERVICE_OPTIONS.map(({ id, label }) => {
            const on = services.has(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleService(id)}
                disabled={running}
                aria-pressed={on}
                className={`px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors disabled:opacity-60 ${
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="mr-1.5">{on ? '✓' : '＋'}</span>{label}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground mb-5">
          Checking a box guarantees that section always appears — even before we find any data for it — so a
          contracted feature never silently vanishes. Leave unchecked if you&apos;re not sure: every service we
          DO find real data for still shows up automatically, exactly as before.
        </p>

        <label className="text-sm font-semibold text-foreground mb-2 block">Company name</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input value={company} onChange={e => setCompany(e.target.value)}
            placeholder="e.g. Acme Pharma — or pick an existing client below" disabled={running}
            list="known-companies-list"
            onKeyDown={e => { if (e.key === 'Enter' && company.trim() && !running) generate() }}
            className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary" />
          <datalist id="known-companies-list">
            {knownCompanies.map(c => (
              <option key={c.id} value={c.name}>
                {c.sessions > 0 ? `${c.sessions} sessions, ${c.users} users` : 'no activity yet'}
              </option>
            ))}
          </datalist>
          <button onClick={generate} disabled={running || starting || !company.trim()}
            className="px-6 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
            {running ? 'Generating…' : '✨ Generate Dashboard'}
          </button>
        </div>
        {knownCompanies.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            Start typing to pick from {knownCompanies.filter(c => c.sessions > 0).length} existing rolplay_app_sql
            clients with real activity, or type a new company name.
          </p>
        )}

        {/* Company email domain — optional but strongly recommended. This is
            what decides which logins can see the finished dashboard, so a
            correct value here avoids the "guessed the wrong domain, nobody can
            log in" problem. */}
        <label className="text-sm font-semibold text-foreground mt-4 mb-2 block">
          Company email domain <span className="font-normal text-muted-foreground">(recommended)</span>
        </label>
        <input value={domainText} onChange={e => setDomainText(e.target.value)}
          placeholder="e.g. acmepharma.com — the domain their team uses to log in" disabled={running}
          className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        <p className="text-xs text-muted-foreground mt-1">
          Everyone who logs in with an email at this domain will see this dashboard. Ask the client which domain
          their team uses. Leave blank only if you&apos;re not sure — you can set it later.
        </p>

        <button type="button" onClick={() => setShowAdvanced(v => !v)}
          className="mt-3 text-xs text-muted-foreground hover:text-foreground">
          {showAdvanced ? '▾' : '▸'} Advanced (optional)
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">Exercise IDs</label>
              <input value={idsText} onChange={e => setIdsText(e.target.value)}
                placeholder="Leave blank — the AI finds these automatically" disabled={running}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              <p className="text-xs text-muted-foreground mt-1">Only fill this in if you already know the specific exercise IDs. Otherwise leave it empty.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)} disabled={running}
                className="rounded border-border" />
              Mark this dashboard&apos;s published link as CONFIDENTIAL
            </label>
            <p className="text-xs text-muted-foreground -mt-2">
              Shows a confidential label on the published view — use this before sharing a link outside the
              client&apos;s normal login.
            </p>
          </div>
        )}
      </div>

      {/* Progress */}
      {job && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {PHASE_STEPS.map((s, i) => {
                const state = job.phase === 'error' ? (i <= currentIdx ? 'done' : 'todo')
                  : (currentIdx > i || job.phase === 'done') ? 'done' : currentIdx === i ? 'current' : 'todo'
                return (
                  <div key={s.key} className="flex items-center gap-1.5 text-xs">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                      state === 'done' ? 'bg-emerald-500 text-white'
                      : state === 'current' ? 'bg-primary text-primary-foreground animate-pulse'
                      : 'bg-muted text-muted-foreground'}`}>
                      {state === 'done' ? '✓' : i + 1}
                    </span>
                    <span className={state === 'todo' ? 'text-muted-foreground' : 'text-foreground'}>{s.label}</span>
                  </div>
                )
              })}
            </div>
            <span className="text-sm font-bold text-foreground">{job.percent}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${job.phase === 'error' ? 'bg-destructive' : 'bg-primary'}`}
              style={{ width: `${job.percent}%` }} />
          </div>

          {/* Progress feed — plain-language activity list, not a developer console */}
          <div className="mt-4 max-h-52 overflow-y-auto rounded-lg bg-background border border-border/60 p-3 text-xs space-y-1.5">
            {job.logs.map((l, i) => (
              <div key={i} className={`flex items-start gap-2 ${
                l.level === 'error' ? 'text-destructive'
                : l.level === 'warn' ? 'text-amber-600 dark:text-amber-400'
                : l.level === 'success' ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'}`}>
                <span className="shrink-0">{l.level === 'success' ? '✓' : l.level === 'error' ? '✗' : l.level === 'warn' ? '!' : '•'}</span>
                <span>{l.message}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>

          {/* Error — a clear, actionable card, never a raw exception string */}
          {job.phase === 'error' && (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">We couldn&apos;t find this company&apos;s data yet</p>
              <p className="text-xs text-muted-foreground mb-3">
                This usually means the company hasn&apos;t been connected to any of our systems yet — it&apos;s not
                necessarily a problem on your end. Double-check the company name for typos and try again, or reach
                out to support if you believe this company should already be connected.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => { setJob(null); setCompany('') }}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90">
                  Try again
                </button>
                <a href="mailto:info@rolplay.ai?subject=Dashboard%20builder%20-%20company%20not%20found"
                  className="text-xs font-semibold text-primary hover:underline">
                  Contact support
                </a>
              </div>
            </div>
          )}

          {/* Pause: connector found, but this bridge has no way to list its own
              exercise/usecase IDs — genuinely need someone with system access
              to supply them. Not a failure — a normal one-time setup step. */}
          {job.phase === 'needs_ids' && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">One more thing needed — this is normal, not an error</p>
              <p className="text-xs text-muted-foreground mb-3">
                We found your company&apos;s data ({humanizeConnector(job.pending_connector)}), but this particular system
                doesn&apos;t let us automatically list the ID numbers for each training scenario. If you already know them,
                enter them below. If not, that&apos;s fine — copy the message below and send it to whoever manages your
                training platform (usually your IT team or platform admin). Once you have the numbers, come back and paste
                them in.
              </p>
              <div className="mb-3 rounded-lg border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{requestTemplate()}</p>
                <button onClick={copyTemplate} type="button"
                  className="mt-2 text-xs font-semibold text-primary hover:underline">
                  {copied ? '✓ Copied' : 'Copy this message'}
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input value={pendingIdsText} onChange={e => setPendingIdsText(e.target.value)}
                  placeholder="e.g. 137, 159, 173" disabled={resuming}
                  onKeyDown={e => { if (e.key === 'Enter' && pendingIdsText.trim()) provideIds() }}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                <button onClick={provideIds} disabled={resuming || !pendingIdsText.trim()}
                  className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
                  {resuming ? 'Continuing…' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {/* Pause: schema discovery found the company's REAL modules — the
              manager reviews/narrows exactly that list, never picks blind. */}
          {job.phase === 'review_services' && (
            <div className="mt-4 rounded-xl border border-border bg-background p-4">
              <p className="text-sm font-semibold text-foreground mb-1">We found these real services for your company</p>
              <p className="text-xs text-muted-foreground mb-3">
                These are the services your training data actually contains — nothing guessed. Uncheck any you don&apos;t
                want included in the dashboard.
              </p>
              <div className="space-y-2 mb-4">
                {(job.available_modules ?? []).map(m => (
                  <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={selectedModules.has(m)} onChange={() => toggleModule(m)}
                      className="rounded border-border" />
                    {m}
                  </label>
                ))}
              </div>
              <button onClick={confirmServices} disabled={resuming || selectedModules.size === 0}
                className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {resuming ? 'Continuing…' : `Continue with ${selectedModules.size} selected`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Preview */}
      {job?.dashboard && job.preview && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">{job.dashboard.title}</h2>
              <p className="text-xs text-muted-foreground">Live preview · source: {humanizeConnector(job.dashboard.connector)} · real data</p>
            </div>
            {job.validation && (
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${job.validation.ok ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                {job.validation.ok ? 'Validation passed' : 'Validation failed'} · {job.validation.summary}
              </span>
            )}
          </div>

          <DashboardRenderer config={job.dashboard} preview={job.preview} />

          {job.dashboard.recommendations.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-muted-foreground list-disc pl-5">
              {job.dashboard.recommendations.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}

          {/* A dashboard can pass validation while genuinely showing nothing —
              the source connects fine but has no data yet for this scope. That
              looks identical to "broken" to a non-technical viewer, so make it
              impossible to publish this without seeing it spelled out first. */}
          {job.validation?.issues.some(i => i.code === 'no_data') && (
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">Heads up — this dashboard will look empty</p>
              <p className="text-xs text-muted-foreground mb-3">
                We connected to {company || 'this company'}&apos;s system successfully, but it has no data yet for the
                current view. If you publish now, whoever looks at it will see blank charts and zeros — that&apos;s
                expected for a brand-new company with no activity yet, but worth confirming before you go ahead.
              </p>
              <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                <input type="checkbox" checked={acknowledgedEmpty} onChange={e => setAcknowledgedEmpty(e.target.checked)}
                  className="rounded border-border" />
                I understand this will publish with no visible data yet
              </label>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={publish}
              disabled={
                publishing || job.published ||
                (job.validation ? !job.validation.ok : false) ||
                (!!job.validation?.issues.some(i => i.code === 'no_data') && !acknowledgedEmpty)
              }
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {job.published ? '✓ Published — live' : publishing ? 'Publishing…' : 'Publish dashboard'}
            </button>
            {job.published && <span className="text-xs text-muted-foreground">Live within ~30s. Users on this company&apos;s domain now see it.</span>}
            {publishError && <span className="text-xs text-destructive">{publishError}</span>}
            {publishedSlug && (
              <a href={`/d/${publishedSlug}`} target="_blank" rel="noreferrer"
                className="text-xs font-semibold text-primary hover:underline">
                Open published dashboard
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
