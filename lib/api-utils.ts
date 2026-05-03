/**
 * api-utils.ts — server-side API response helpers.
 *
 * Every route MUST use buildSuccess() and buildApiError() so responses
 * always conform to the standard contract:
 *
 *   { success, data, meta: { filters, timestamp, source } }
 *
 * Client-side: the useApi hook auto-unwraps .data so pages receive
 * the typed payload directly — no page changes needed when adopting this.
 */

import { NextResponse } from "next/server"
import { solutionToUsecaseIds } from "./solution-map"

// ── Standard response shape ───────────────────────────────────────────────────

export interface ApiMeta {
  filters:   Record<string, unknown>
  timestamp: string
  source:    "db"
}

export interface ApiResponse<T> {
  success: boolean
  data:    T
  meta:    ApiMeta
}

// ── Response builders ─────────────────────────────────────────────────────────

/**
 * Builds a successful JSON response wrapped in the standard contract.
 *
 * @param data    The payload — typed as T, placed in .data
 * @param filters Filters applied to this request (logged in .meta.filters)
 */
export function buildSuccess<T>(
  data:    T,
  filters: Record<string, unknown> = {}
): NextResponse {
  const body: ApiResponse<T> = {
    success: true,
    data,
    meta: {
      filters,
      timestamp: new Date().toISOString(),
      source: "db",
    },
  }
  return NextResponse.json(body)
}

/**
 * Builds an error JSON response in the standard contract format.
 * Always use this instead of raw NextResponse.json({ error }) so the
 * client always gets a predictable shape on failure.
 */
export function buildApiError(
  message: string,
  status = 500,
  filters: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      data:    { message },
      meta: {
        filters,
        timestamp: new Date().toISOString(),
        source:    "db",
      },
    },
    { status }
  )
}

// ── Request param parsers ─────────────────────────────────────────────────────

/**
 * Parses and validates from/to date params from a URLSearchParams object.
 * Returns null when either date is missing or invalid.
 */
export function parseDateRange(
  searchParams: URLSearchParams
): { from: Date; to: Date } | null {
  const from = new Date(searchParams.get("from") ?? "")
  const to   = new Date(searchParams.get("to")   ?? "")
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null
  if (from > to) return null
  return { from, to }
}

/**
 * Parses solution or usecaseIds filter params.
 * ?solution=coach  → resolves to the known usecase IDs for that solution
 * ?usecaseIds=1,2  → uses those IDs directly
 * (neither)        → undefined = no filter (all usecases)
 */
export function parseUsecaseFilter(searchParams: URLSearchParams): {
  solution:   string | null
  usecaseIds: number[] | undefined
} {
  const solution = searchParams.get("solution")
  if (solution) {
    return { solution, usecaseIds: solutionToUsecaseIds(solution) }
  }
  const idsParam = searchParams.get("usecaseIds")
  const usecaseIds = idsParam
    ? idsParam.split(",").map(Number).filter((n) => !isNaN(n))
    : undefined
  return { solution: null, usecaseIds }
}
