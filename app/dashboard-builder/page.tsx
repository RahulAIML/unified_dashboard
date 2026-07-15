'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { DashboardRenderer } from '@/components/DashboardRenderer'

// ── Types mirroring the AI service JobState ─────────────────────────────────────
type Phase =
  | 'queued' | 'planning' | 'company_discovery' | 'service_discovery'
  | 'schema_discovery' | 'dashboard_planning' | 'dashboard_config'
  | 'validation' | 'preview' | 'publish' | 'done' | 'error'

interface JobLog { ts: string; phase: Phase; level: 'info' | 'warn' | 'error' | 'success'; message: string }
interface WidgetPreview { widget_id: string; ok: boolean; value?: number | string | null; series?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; error?: string | null }
interface WidgetConfig { id: string; type: string; title: string; metric_key?: string | null; span?: number }
interface DashRow { id: string; title?: string | null; widgets: WidgetConfig[] }
interface DashboardConfig { company: string; slug: string; title: string; connector: string; rows: DashRow[]; recommendations: string[] }
interface ValidationIssue { severity: 'error' | 'warning' | 'info'; code: string; message: string }
interface ValidationReport { ok: boolean; issues: ValidationIssue[]; summary: string }
interface JobState {
  job_id: string; phase: Phase; percent: number; logs: JobLog[]
  dashboard?: DashboardConfig | null; validation?: ValidationReport | null
  preview?: { widgets: WidgetPreview[] } | null; published?: boolean; error?: string | null
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

export default function DashboardBuilderPage() {
  const [company, setCompany] = useState('')
  const [idsText, setIdsText] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [job, setJob] = useState<JobState | null>(null)
  const [starting, setStarting] = useState(false)
  const [publishing, setPublishing] = useState(false)
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
        if (j.phase === 'done' || j.phase === 'error') stopPoll()
      } catch { /* keep polling */ }
    }, 1000)
  }, [])

  async function generate() {
    if (!company.trim()) return
    setStarting(true); setJob(null)
    const exercise_ids = idsText.split(/[,\s]+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n))
    try {
      const res = await fetch('/api/ai/generate-dashboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: company.trim(), exercise_ids }),
      })
      const j: JobState = await res.json()
      setJob(j); poll(j.job_id)
    } finally { setStarting(false) }
  }

  async function publish() {
    if (!job) return
    setPublishing(true)
    try {
      const res = await fetch('/api/ai/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id }),
      })
      const r = await res.json()
      setJob(prev => prev ? { ...prev, published: !!r.published } : prev)
    } finally { setPublishing(false) }
  }

  const running = !!job && job.phase !== 'done' && job.phase !== 'error'
  const currentIdx = job ? ORDER.indexOf(job.phase === 'dashboard_config' ? 'dashboard_planning' : job.phase) : -1

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
        <label className="text-sm font-semibold text-foreground mb-2 block">Company name</label>
        <div className="flex flex-col sm:flex-row gap-3">
          <input value={company} onChange={e => setCompany(e.target.value)}
            placeholder="e.g. Apotex" disabled={running}
            onKeyDown={e => { if (e.key === 'Enter' && company.trim() && !running) generate() }}
            className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-primary" />
          <button onClick={generate} disabled={running || starting || !company.trim()}
            className="px-6 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap">
            {running ? 'Generating…' : '✨ Generate Dashboard'}
          </button>
        </div>

        <button type="button" onClick={() => setShowAdvanced(v => !v)}
          className="mt-3 text-xs text-muted-foreground hover:text-foreground">
          {showAdvanced ? '▾' : '▸'} Advanced (optional)
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <label className="text-xs font-medium text-foreground mb-1 block">Exercise IDs</label>
            <input value={idsText} onChange={e => setIdsText(e.target.value)}
              placeholder="Leave blank — the AI finds these automatically" disabled={running}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            <p className="text-xs text-muted-foreground mt-1">Only fill this in if you already know the specific exercise IDs. Otherwise leave it empty.</p>
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

          {/* Live logs */}
          <div className="mt-4 max-h-52 overflow-y-auto rounded-lg bg-background border border-border/60 p-3 font-mono text-xs space-y-1">
            {job.logs.map((l, i) => (
              <div key={i} className={
                l.level === 'error' ? 'text-destructive'
                : l.level === 'warn' ? 'text-amber-600 dark:text-amber-400'
                : l.level === 'success' ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'}>
                {l.level === 'success' ? '✓' : l.level === 'error' ? '✗' : l.level === 'warn' ? '!' : '·'} {l.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
          {job.error && <p className="mt-3 text-sm text-destructive">{job.error}</p>}
        </div>
      )}

      {/* Preview */}
      {job?.dashboard && job.preview && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-foreground">{job.dashboard.title}</h2>
              <p className="text-xs text-muted-foreground">Live preview · connector: {job.dashboard.connector} · real data</p>
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

          <div className="mt-6 flex items-center gap-3">
            <button onClick={publish} disabled={publishing || job.published || (job.validation ? !job.validation.ok : false)}
              className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {job.published ? '✓ Published — live' : publishing ? 'Publishing…' : 'Publish dashboard'}
            </button>
            {job.published && <span className="text-xs text-muted-foreground">Live within ~30s. Users on this company&apos;s domain now see it.</span>}
          </div>
        </div>
      )}
    </div>
  )
}
