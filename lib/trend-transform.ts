/**
 * trend-transform.ts
 *
 * Pure, pipeline-agnostic transforms applied to the /api/dashboard/trends
 * result AFTER a pipeline (pharma / banco / standard / rolplay-app) has produced
 * a daily series. Doing this at the route level means previous-period overlay
 * and Daily/Weekly/Monthly bucketing work identically for every org type with
 * zero per-pipeline changes.
 */

import type { ApiTrendPoint, TrendsApiResponse } from './types'

export type Granularity = 'daily' | 'weekly' | 'monthly'

export function isGranularity(v: string | null | undefined): v is Granularity {
  return v === 'daily' || v === 'weekly' || v === 'monthly'
}

/** Bucket key for a YYYY-MM-DD date: ISO week-start (Mon) for weekly, YYYY-MM for
 *  monthly. Computed in UTC so it never shifts with the server timezone. */
function bucketKey(dateIso: string, gran: Granularity): string {
  if (gran === 'monthly') return dateIso.slice(0, 7) // YYYY-MM
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateIso
  const dow = d.getUTCDay()             // 0=Sun..6=Sat
  const backToMon = dow === 0 ? 6 : dow - 1
  d.setUTCDate(d.getUTCDate() - backToMon)
  return d.toISOString().slice(0, 10)
}

/**
 * Aggregate a daily series into weekly/monthly buckets. `agg` is 'avg' for score
 * series (average of the days) and 'sum' for count series. value2 (when present,
 * e.g. pass/fail) is aggregated with the same rule. Daily passes through as-is.
 */
export function bucketTrend(points: ApiTrendPoint[], gran: Granularity, agg: 'avg' | 'sum'): ApiTrendPoint[] {
  if (gran === 'daily' || points.length === 0) return points

  const groups = new Map<string, ApiTrendPoint[]>()
  for (const p of points) {
    const k = bucketKey(p.date, gran)
    const g = groups.get(k)
    if (g) g.push(p); else groups.set(k, [p])
  }

  const combine = (nums: number[]): number => {
    if (nums.length === 0) return 0
    const sum = nums.reduce((s, n) => s + n, 0)
    return agg === 'sum' ? sum : Math.round((sum / nums.length) * 10) / 10
  }

  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, ps]) => {
      const out: ApiTrendPoint = { date, value: combine(ps.map(p => p.value)) }
      const v2 = ps.filter(p => p.value2 != null).map(p => p.value2 as number)
      if (v2.length) out.value2 = combine(v2)
      return out
    })
}

/** Bucket every series in a trends response by the given granularity. */
export function bucketTrends(data: TrendsApiResponse, gran: Granularity): TrendsApiResponse {
  if (gran === 'daily') return data
  return {
    ...data,
    scoreTrend:     bucketTrend(data.scoreTrend,     gran, 'avg'),
    evalCountTrend: bucketTrend(data.evalCountTrend, gran, 'sum'),
    passFailTrend:  bucketTrend(data.passFailTrend,  gran, 'sum'),
    // scoreDistribution is not a time series — leave untouched.
  }
}

/**
 * Overlay the previous period's score series onto the current one as value2,
 * aligned by index (day/bucket N of current ↔ N of previous) so the chart can
 * draw "this period vs previous". Bucket BOTH series first, then align.
 */
export function attachPreviousScore(current: TrendsApiResponse, previousScore: ApiTrendPoint[]): TrendsApiResponse {
  return {
    ...current,
    scoreTrend: current.scoreTrend.map((p, i) =>
      previousScore[i] != null ? { ...p, value2: previousScore[i].value } : p
    ),
  }
}
