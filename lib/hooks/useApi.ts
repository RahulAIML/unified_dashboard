"use client"

import { useEffect, useRef, useState } from "react"

interface ApiState<T> {
  data:    T | null
  loading: boolean
  error:   string | null
}

/**
 * Generic fetch hook for dashboard API routes.
 *
 * Auto-unwraps the standard ApiResponse wrapper:
 *   { success, data, meta } → returns .data as T
 *
 * This means pages always receive the typed payload directly — no page
 * changes are needed when routes adopt the standard contract format.
 * Falls back to returning the raw response if the wrapper is absent
 * (backward-compatible).
 *
 * Refetches whenever `url` changes. Returns { data, loading, error }.
 */
export function useApi<T>(url: string | null): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data:    null,
    loading: true,
    error:   null,
  })

  const lastUrl = useRef<string | null>(null)

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null })
      return
    }

    let cancelled = false
    lastUrl.current = url

    setState((s) => ({ ...s, loading: true, error: null }))

    fetch(url)
      .then(async (res) => {
        const json = await res.json()

        if (!res.ok) {
          // Prefer the error field from the standard contract, then generic message
          const errMsg = json?.error ?? `HTTP ${res.status}`
          throw new Error(errMsg)
        }

        // ── Auto-unwrap standard ApiResponse contract ─────────────────────
        // Shape: { success: boolean, data: T, meta: {...} }
        if (
          json !== null &&
          typeof json === "object" &&
          "success" in json &&
          "data" in json
        ) {
          if (!json.success) {
            throw new Error(json.error ?? "API returned success: false")
          }
          return json.data as T
        }

        // Legacy / non-wrapped response — return as-is
        return json as T
      })
      .then((data) => {
        if (!cancelled && lastUrl.current === url) {
          setState({ data, loading: false, error: null })
        }
      })
      .catch((err) => {
        if (!cancelled && lastUrl.current === url) {
          setState({
            data:    null,
            loading: false,
            error:   String(err?.message ?? err),
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [url])

  return state
}

/**
 * Builds a dashboard API URL with date-range query params.
 *
 * @example
 *   buildApiUrl("/api/dashboard/overview", from, to, { solution: "coach" })
 *   // → "/api/dashboard/overview?from=...&to=...&solution=coach"
 */
export function buildApiUrl(
  path:  string,
  from:  Date,
  to:    Date,
  extra?: Record<string, string>
): string {
  const p = new URLSearchParams({
    from: from.toISOString(),
    to:   to.toISOString(),
    ...extra,
  })
  return `${path}?${p.toString()}`
}
