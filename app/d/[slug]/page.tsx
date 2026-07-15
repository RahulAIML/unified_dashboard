'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { DashboardRenderer, type DashboardConfig, type WidgetPreview } from '@/components/DashboardRenderer'

interface RenderResponse { config: DashboardConfig; preview: { widgets: WidgetPreview[] } }

export default function PublishedDashboardPage() {
  const params = useParams<{ slug: string }>()
  const slug = params?.slug
  const [data, setData] = useState<RenderResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/ai/render/${slug}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(res.status === 404 ? 'This dashboard has not been published yet.' : `Failed to load (${res.status})`)
        const json: RenderResponse = await res.json()
        if (!cancelled) setData(json)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [slug])

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
        <h1 className="text-2xl font-bold text-foreground">{data.config.title}</h1>
        <p className="text-sm text-muted-foreground">Live data · {data.config.connector.replace(/_/g, ' ')}</p>
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
