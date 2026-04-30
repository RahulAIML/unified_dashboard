"use client"

import { useEffect, useRef, useReducer } from "react"

interface ApiState<T> {
  data:    T | null
  loading: boolean
  error:   string | null
}

const DEFAULT_TIMEOUT_MS = 12_000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (!isRecord(json)) return fallback

  const data = json["data"]
  if (isRecord(data) && typeof data["message"] === "string") return data["message"]

  const err = json["error"]
  if (typeof err === "string") return err

  return fallback
}

function isApiResponseLike(v: unknown): v is { success: boolean; data: unknown } {
  return isRecord(v) && typeof v["success"] === "boolean" && "data" in v
}

async function fetchJsonWithTimeout(url: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'include' })
    const json = await res.json().catch(() => null)
    return { res, json }
  } finally {
    clearTimeout(tid)
  }
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
  type Action =
    | { type: "reset" }
    | { type: "start" }
    | { type: "success"; data: T }
    | { type: "error"; error: string }

  const [state, dispatch] = useReducer(
    (s: ApiState<T>, a: Action): ApiState<T> => {
      switch (a.type) {
        case "reset":
          return { data: null, loading: false, error: null }
        case "start":
          return { ...s, loading: true, error: null }
        case "success":
          return { data: a.data, loading: false, error: null }
        case "error":
          return { data: null, loading: false, error: a.error }
        default:
          return s
      }
    },
    { data: null, loading: Boolean(url), error: null }
  )

  const lastUrl = useRef<string | null>(null)

  useEffect(() => {
    if (!url) {
      dispatch({ type: "reset" })
      return
    }

    let cancelled = false
    lastUrl.current = url

    dispatch({ type: "start" })

    fetchJsonWithTimeout(url)
      .then(async ({ res, json }) => {

        if (!res.ok) {
          throw new Error(extractErrorMessage(json, `HTTP ${res.status}`))
        }

        // ── Auto-unwrap standard ApiResponse contract ─────────────────────
        // Shape: { success: boolean, data: T, meta: {...} }
        if (isApiResponseLike(json)) {
          if (!json.success) {
            throw new Error(extractErrorMessage(json, "Request failed"))
          }
          return json.data as T
        }

        // Legacy / non-wrapped response — return as-is
        return json as T
      })
      .then((data) => {
        if (!cancelled && lastUrl.current === url) {
          dispatch({ type: "success", data })
        }
      })
      .catch((err) => {
        if (!cancelled && lastUrl.current === url) {
          console.warn("[useApi]", url, err)
          dispatch({
            type:  "error",
            error: String((err as { message?: unknown })?.message ?? err),
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
  extra?: Record<string, string | number | null | undefined>
): string {
  const p = new URLSearchParams({
    from: from.toISOString(),
    to:   to.toISOString(),
  })

  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined) continue
      p.set(k, String(v))
    }
  }
  return `${path}?${p.toString()}`
}
