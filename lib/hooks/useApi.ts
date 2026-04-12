"use client"

import { useEffect, useRef, useState } from 'react'

interface ApiState<T> {
  data:    T | null
  loading: boolean
  error:   string | null
}

/**
 * Generic fetch hook for dashboard API routes.
 * Refetches whenever `url` changes (include query params in the url).
 * Returns { data, loading, error }.
 */
export function useApi<T>(url: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data:    null,
    loading: true,
    error:   null,
  })

  // Track the last url that triggered a request to avoid stale results
  const lastUrl = useRef<string | null>(null)

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null })
      return
    }

    let cancelled = false
    lastUrl.current = url

    setState(s => ({ ...s, loading: true, error: null }))

    fetch(url)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
        return json as T
      })
      .then(data => {
        if (!cancelled && lastUrl.current === url) {
          setState({ data, loading: false, error: null })
        }
      })
      .catch(err => {
        if (!cancelled && lastUrl.current === url) {
          setState({ data: null, loading: false, error: String(err?.message ?? err) })
        }
      })

    return () => { cancelled = true }
  }, [url])

  return state
}

/** Build a dashboard API URL with date-range query params. */
export function buildApiUrl(
  path: string,
  from: Date,
  to:   Date,
  extra?: Record<string, string>
): string {
  const p = new URLSearchParams({
    from: from.toISOString(),
    to:   to.toISOString(),
    ...extra,
  })
  return `${path}?${p.toString()}`
}
