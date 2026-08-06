'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { DashboardRenderer, humanizeConnector, type DashboardConfig, type WidgetPreview } from '@/components/DashboardRenderer'

interface RenderResponse { config: DashboardConfig; preview: { widgets: WidgetPreview[] } }

// Message per status from /api/dashboard-view/[slug] — that route enforces
// that only an admin or a user whose resolved tenant owns this slug may view
// it (see its own docstring for why), so 401/403 are real, expected outcomes
// here, not bugs.
function messageFor(status: number): string {
  if (status === 404) return 'This dashboard has not been published yet.'
  if (status === 403) return 'You do not have access to this dashboard.'
  if (status === 401) return 'Please log in to view this dashboard.'
  return `Failed to load (${status})`
}

export default function PublishedDashboardPage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const slug = params?.slug
  const [data, setData] = useState<RenderResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    let hasLoadedOnce = false
    const load = async () => {
      // Only show the full-page spinner (which unmounts DashboardRenderer)
      // on the very first load. Background refreshes on the 15s interval
      // must update data in place, or every refresh wipes the user's active
      // tab, search text, and table pagination back to defaults.
      if (!hasLoadedOnce) setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/dashboard-view/${slug}`, { cache: 'no-store' })
        if (res.status === 401) {
          // /auth/login has no post-login redirect-target support today, so
          // this sends the user there plainly rather than implying a "come
          // back here after logging in" behavior that doesn't exist yet.
          if (!cancelled) router.replace('/auth/login')
          return
        }
        if (!res.ok) throw new Error(messageFor(res.status))
        const json: RenderResponse = await res.json()
        if (!cancelled) {
          setData(json)
          setLastUpdated(new Date().toLocaleTimeString())
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
        hasLoadedOnce = true
      }
    }

    void load()
    const interval = window.setInterval(() => {
      void load()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [slug, router])

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-3" />
          <div className="text-sm text-muted-foreground">Loading dashboard…</div>
        </div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-lg font-semibold text-foreground mb-2">Dashboard unavailable</h1>
        <p className="text-sm text-muted-foreground">{error ?? 'Not found.'}</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{data.config.title}</h1>
          {data.config.confidential && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold tracking-wide bg-destructive/10 text-destructive border border-destructive/30">
              CONFIDENTIAL
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Live data · {humanizeConnector(data.config.connector)}{lastUpdated ? ` · refreshed ${lastUpdated}` : ''}
        </p>
      </header>
      <DashboardRenderer config={data.config} preview={data.preview} />
      {data.config.recommendations?.length > 0 && (
        <ul className="mt-6 space-y-1 text-xs text-muted-foreground list-disc pl-5">
          {data.config.recommendations.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  )
}
