import { describe, it, expect } from 'vitest'
import { bucketTrend, bucketTrends, attachPreviousScore, isGranularity } from '../trend-transform'
import type { ApiTrendPoint, TrendsApiResponse } from '../types'

const daily: ApiTrendPoint[] = [
  { date: '2026-01-05', value: 80 }, // Mon (week of 01-05)
  { date: '2026-01-06', value: 90 }, // Tue
  { date: '2026-01-12', value: 60 }, // next Mon (week of 01-12)
  { date: '2026-02-02', value: 100 }, // Feb
]

describe('isGranularity', () => {
  it('accepts valid values, rejects others', () => {
    expect(isGranularity('weekly')).toBe(true)
    expect(isGranularity('daily')).toBe(true)
    expect(isGranularity('monthly')).toBe(true)
    expect(isGranularity('yearly')).toBe(false)
    expect(isGranularity(null)).toBe(false)
  })
})

describe('bucketTrend', () => {
  it('passes daily through unchanged', () => {
    expect(bucketTrend(daily, 'daily', 'avg')).toBe(daily)
  })

  it('averages score series into ISO-week buckets (Mon start)', () => {
    const out = bucketTrend(daily, 'weekly', 'avg')
    expect(out).toEqual([
      { date: '2026-01-05', value: 85 }, // (80+90)/2
      { date: '2026-01-12', value: 60 },
      { date: '2026-02-02', value: 100 }, // Feb 2 2026 is itself a Monday → its own week-start
    ])
  })

  it('sums count series by month', () => {
    const counts: ApiTrendPoint[] = [
      { date: '2026-01-05', value: 3 },
      { date: '2026-01-20', value: 7 },
      { date: '2026-02-02', value: 5 },
    ]
    expect(bucketTrend(counts, 'monthly', 'sum')).toEqual([
      { date: '2026-01', value: 10 },
      { date: '2026-02', value: 5 },
    ])
  })

  it('aggregates value2 with the same rule when present', () => {
    const withV2: ApiTrendPoint[] = [
      { date: '2026-01-05', value: 4, value2: 1 },
      { date: '2026-01-06', value: 6, value2: 3 },
    ]
    expect(bucketTrend(withV2, 'weekly', 'sum')).toEqual([
      { date: '2026-01-05', value: 10, value2: 4 },
    ])
  })

  it('handles empty input', () => {
    expect(bucketTrend([], 'monthly', 'avg')).toEqual([])
  })
})

describe('bucketTrends', () => {
  it('uses avg for score, sum for counts/passfail; leaves distribution alone', () => {
    const data: TrendsApiResponse = {
      scoreTrend: [ { date: '2026-01-05', value: 80 }, { date: '2026-01-06', value: 90 } ],
      evalCountTrend: [ { date: '2026-01-05', value: 2 }, { date: '2026-01-06', value: 3 } ],
      passFailTrend: [ { date: '2026-01-05', value: 1 }, { date: '2026-01-06', value: 4 } ],
      scoreDistribution: [ { range: '80-89', count: 5, pct: 50 } ],
    }
    const out = bucketTrends(data, 'weekly')
    expect(out.scoreTrend).toEqual([{ date: '2026-01-05', value: 85 }])
    expect(out.evalCountTrend).toEqual([{ date: '2026-01-05', value: 5 }])
    expect(out.passFailTrend).toEqual([{ date: '2026-01-05', value: 5 }])
    expect(out.scoreDistribution).toEqual(data.scoreDistribution)
  })

  it('returns input unchanged for daily', () => {
    const data: TrendsApiResponse = { scoreTrend: [], evalCountTrend: [], passFailTrend: [] }
    expect(bucketTrends(data, 'daily')).toBe(data)
  })
})

describe('attachPreviousScore', () => {
  it('aligns previous score by index as value2', () => {
    const cur: TrendsApiResponse = {
      scoreTrend: [ { date: '2026-02-01', value: 70 }, { date: '2026-02-02', value: 75 } ],
      evalCountTrend: [], passFailTrend: [],
    }
    const prev: ApiTrendPoint[] = [ { date: '2026-01-01', value: 60 }, { date: '2026-01-02', value: 65 } ]
    const out = attachPreviousScore(cur, prev)
    expect(out.scoreTrend).toEqual([
      { date: '2026-02-01', value: 70, value2: 60 },
      { date: '2026-02-02', value: 75, value2: 65 },
    ])
  })

  it('leaves points without a previous counterpart untouched', () => {
    const cur: TrendsApiResponse = {
      scoreTrend: [ { date: '2026-02-01', value: 70 }, { date: '2026-02-02', value: 75 } ],
      evalCountTrend: [], passFailTrend: [],
    }
    const out = attachPreviousScore(cur, [{ date: '2026-01-01', value: 60 }])
    expect(out.scoreTrend[1].value2).toBeUndefined()
  })
})
