/**
 * lib/data-sources.ts -- the multi-source Overview data-access layer.
 * Rolplay App SQL is meant to be the PRIMARY source wherever it resolves
 * for an identity, composed with the tenant's base pharma source rather
 * than replacing it. These tests exercise resolution order, composition,
 * module-scoped exclusion, and safe degradation when only one source
 * resolves -- mirroring the real M8 case this was generalized from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveRolplayAppAccess = vi.fn()
const rolplayAppOverview = vi.fn()
const rolplayAppResults = vi.fn()
const rolplayAppUsecaseBreakdown = vi.fn()
const rolplayAppBestPerformers = vi.fn()
const rolplayAppTrends = vi.fn()
const pharmaDashboardOverview = vi.fn()
const pharmaDashboardResults = vi.fn()
const pharmaDashboardUsecaseBreakdown = vi.fn()
const pharmaDashboardBestPerformers = vi.fn()
const pharmaDashboardTrends = vi.fn()

vi.mock('../bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('../bridge-rolplay-app')>('../bridge-rolplay-app')
  return {
    ...actual, // mergeOverviewSources stays real -- it's the thing under test alongside resolution/composition
    resolveRolplayAppAccess: (...args: unknown[]) => resolveRolplayAppAccess(...args),
    rolplayAppOverview: (...args: unknown[]) => rolplayAppOverview(...args),
    rolplayAppResults: (...args: unknown[]) => rolplayAppResults(...args),
    rolplayAppUsecaseBreakdown: (...args: unknown[]) => rolplayAppUsecaseBreakdown(...args),
    rolplayAppBestPerformers: (...args: unknown[]) => rolplayAppBestPerformers(...args),
    rolplayAppTrends: (...args: unknown[]) => rolplayAppTrends(...args),
  }
})
vi.mock('../bridge-pharma-analytics', () => ({
  pharmaDashboardOverview: (...args: unknown[]) => pharmaDashboardOverview(...args),
  pharmaDashboardResults: (...args: unknown[]) => pharmaDashboardResults(...args),
  pharmaDashboardUsecaseBreakdown: (...args: unknown[]) => pharmaDashboardUsecaseBreakdown(...args),
  pharmaDashboardBestPerformers: (...args: unknown[]) => pharmaDashboardBestPerformers(...args),
  pharmaDashboardTrends: (...args: unknown[]) => pharmaDashboardTrends(...args),
}))

async function fresh() {
  vi.resetModules()
  return import('../data-sources')
}

const RANGE = { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-06-08T00:00:00.000Z', prevFromIso: '2026-05-25T00:00:00.000Z', prevToIso: '2026-05-31T23:59:59.999Z' }

beforeEach(() => {
  resolveRolplayAppAccess.mockReset()
  rolplayAppOverview.mockReset()
  rolplayAppResults.mockReset()
  rolplayAppUsecaseBreakdown.mockReset()
  rolplayAppBestPerformers.mockReset()
  rolplayAppTrends.mockReset()
  pharmaDashboardOverview.mockReset()
  pharmaDashboardResults.mockReset()
  pharmaDashboardUsecaseBreakdown.mockReset()
  pharmaDashboardBestPerformers.mockReset()
  pharmaDashboardTrends.mockReset()
})

describe('resolveDataSources', () => {
  it('orders rolplay-app-sql FIRST when it resolves, ahead of the base pharma tenant', async () => {
    const mod = await fresh()
    resolveRolplayAppAccess.mockResolvedValue(24)
    const sources = await mod.resolveDataSources('rep@arceralifesciences.com', 'm8', null)
    expect(sources).toEqual([
      { kind: 'rolplay-app-sql', clientId: 24 },
      { kind: 'pharma', tenant: 'm8' },
    ])
  })

  it('still includes the base pharma tenant when no rolplay_app_sql secondary resolves', async () => {
    const mod = await fresh()
    resolveRolplayAppAccess.mockResolvedValue(null)
    const sources = await mod.resolveDataSources('rep@sanfer.com.mx', 'sanfer', null)
    expect(sources).toEqual([{ kind: 'pharma', tenant: 'sanfer' }])
  })

  it('never composes a domain squatter in -- relies on resolveRolplayAppAccess, not a bare domain match', async () => {
    const mod = await fresh()
    resolveRolplayAppAccess.mockResolvedValue(null) // fake@arceralifesciences.com is not a real r_user
    const sources = await mod.resolveDataSources('fake@arceralifesciences.com', 'm8', null)
    expect(sources).toEqual([{ kind: 'pharma', tenant: 'm8' }])
  })

  it('skips resolving a secondary source entirely for a module-scoped request, never calling resolveRolplayAppAccess', async () => {
    const mod = await fresh()
    const sources = await mod.resolveDataSources('rep@arceralifesciences.com', 'm8', 'coach')
    expect(sources).toEqual([{ kind: 'pharma', tenant: 'm8' }])
    expect(resolveRolplayAppAccess).not.toHaveBeenCalled()
  })
})

describe('fetchOverview', () => {
  const pharmaData = {
    totalEvaluations: 100, prevTotalEvaluations: 90, avgScore: 80, prevAvgScore: 78,
    passRate: 70, prevPassRate: 65, passedEvaluations: 70, passRateLegend: 'Passing threshold: 70 pts',
  }
  const rolplayData = {
    totalEvaluations: 50, prevTotalEvaluations: 10, avgScore: 90, prevAvgScore: 85,
    passRate: 90, prevPassRate: 80, passedEvaluations: 45,
  }

  it('returns null when no sources resolved at all', async () => {
    const mod = await fresh()
    const result = await mod.fetchOverview([], RANGE, null)
    expect(result).toBeNull()
  })

  it('returns the single source untouched when only one resolves (every existing single-source tenant)', async () => {
    const mod = await fresh()
    pharmaDashboardOverview.mockResolvedValue(pharmaData)
    const result = await mod.fetchOverview([{ kind: 'pharma', tenant: 'sanfer' }], RANGE, null)
    expect(result).toEqual({ data: pharmaData, source: 'pharma-sanfer' })
    expect(rolplayAppOverview).not.toHaveBeenCalled()
  })

  it('composes rolplay-app-sql (primary) with pharma (secondary) for the tenant-wide Overview', async () => {
    const mod = await fresh()
    rolplayAppOverview.mockResolvedValue(rolplayData)
    pharmaDashboardOverview.mockResolvedValue(pharmaData)

    const result = await mod.fetchOverview(
      [{ kind: 'rolplay-app-sql', clientId: 24 }, { kind: 'pharma', tenant: 'm8' }],
      RANGE, null,
    )

    expect(result!.source).toBe('rolplay-app-24+pharma-m8')
    expect(result!.data.totalEvaluations).toBe(150) // 50 + 100
    expect(result!.data.passedEvaluations).toBe(115) // 45 + 70
    // The pharma tenant's configured legend must survive even though its
    // data is the SECOND argument to mergeOverviewSources now that
    // rolplay_app_sql is ordered first -- this is exactly the regression
    // risk the order-independent mergeOverviewSources fix guards against.
    expect(result!.data.passRateLegend).toBe('Passing threshold: 70 pts')
  })

  it('passes the resolved date range through to rolplayAppOverview (not the previous-period fields)', async () => {
    const mod = await fresh()
    rolplayAppOverview.mockResolvedValue(rolplayData)
    pharmaDashboardOverview.mockResolvedValue(pharmaData)

    await mod.fetchOverview(
      [{ kind: 'rolplay-app-sql', clientId: 24 }, { kind: 'pharma', tenant: 'm8' }],
      RANGE, null,
    )

    expect(rolplayAppOverview).toHaveBeenCalledWith(24, { fromIso: RANGE.fromIso, toIso: RANGE.toIso }, null)
    expect(pharmaDashboardOverview).toHaveBeenCalledWith('m8', {
      fromIso: RANGE.fromIso, toIso: RANGE.toIso,
      prevFromIso: RANGE.prevFromIso, prevToIso: RANGE.prevToIso,
      solution: null,
    })
  })

  it('a module-scoped request never reaches fetchOverview with more than one source (resolveDataSources is the sole gatekeeper)', async () => {
    // fetchOverview itself composes whatever it's given, unconditionally --
    // the "module tabs stay single-source" guarantee lives entirely in
    // resolveDataSources (see its own describe block above), which for
    // solution='coach' only ever returns [{ kind: 'pharma', ... }]. This
    // test documents that contract at the fetchOverview call site: a
    // single-source list for a module request is passed straight through.
    const mod = await fresh()
    pharmaDashboardOverview.mockResolvedValue(pharmaData)

    const result = await mod.fetchOverview([{ kind: 'pharma', tenant: 'm8' }], RANGE, 'coach')

    expect(result!.source).toBe('pharma-m8')
    expect(rolplayAppOverview).not.toHaveBeenCalled()
  })

  it('degrades safely when the composed secondary has no real data in range (null rate excluded, not fabricated)', async () => {
    const mod = await fresh()
    rolplayAppOverview.mockResolvedValue({
      totalEvaluations: 0, prevTotalEvaluations: 0, avgScore: null, prevAvgScore: null,
      passRate: null, prevPassRate: null, passedEvaluations: 0,
    })
    pharmaDashboardOverview.mockResolvedValue(pharmaData)

    const result = await mod.fetchOverview(
      [{ kind: 'rolplay-app-sql', clientId: 24 }, { kind: 'pharma', tenant: 'm8' }],
      RANGE, null,
    )

    expect(result!.data.totalEvaluations).toBe(100) // pharma's count, unaffected by the empty secondary
    expect(result!.data.avgScore).toBe(80) // pharma's real avg, not diluted toward 0
  })
})

describe('fetchResults', () => {
  it('returns null for an empty source list', async () => {
    const mod = await fresh()
    expect(await mod.fetchResults([], 50, RANGE, null)).toBeNull()
  })

  it('returns an empty row list untouched when the single source has no data in range', async () => {
    const mod = await fresh()
    pharmaDashboardResults.mockResolvedValue({ data: [] })
    const result = await mod.fetchResults([{ kind: 'pharma', tenant: 'sanfer' }], 50, RANGE, null)
    expect(result).toEqual({ data: [], source: 'pharma-sanfer' })
  })
})

describe('fetchUsecaseBreakdown', () => {
  it('returns null for an empty source list', async () => {
    const mod = await fresh()
    expect(await mod.fetchUsecaseBreakdown([], RANGE, null)).toBeNull()
  })

  it('returns an empty list untouched when the single source has no usecases in range', async () => {
    const mod = await fresh()
    pharmaDashboardUsecaseBreakdown.mockResolvedValue({ data: [] })
    const result = await mod.fetchUsecaseBreakdown([{ kind: 'pharma', tenant: 'sanfer' }], RANGE, null)
    expect(result).toEqual({ data: [], source: 'pharma-sanfer' })
  })
})

describe('fetchBestPerformers', () => {
  it('returns null for an empty source list', async () => {
    const mod = await fresh()
    expect(await mod.fetchBestPerformers([], 10, RANGE, null)).toBeNull()
  })

  it('passes allTimeStats through from the single source untouched', async () => {
    const mod = await fresh()
    const allTimeStats = { totalRecords: 500, avgBestScore: 88, recordsGe80: 300, uniqueUsers: 40, uniqueSims: 5 }
    pharmaDashboardBestPerformers.mockResolvedValue({ data: [], allTimeStats })
    const result = await mod.fetchBestPerformers([{ kind: 'pharma', tenant: 'sanfer' }], 10, RANGE, null)
    expect(result!.allTimeStats).toEqual(allTimeStats)
  })

  it('never divides by zero when both merged rows have zero sessions (malformed/degenerate input)', async () => {
    const mod = await fresh()
    const zeroRow = { user_email: 'x@m8.com', user_name: null, sessions: 0, avg_score: 0, pass_rate: 0 }
    pharmaDashboardBestPerformers.mockResolvedValue({ data: [zeroRow] })
    rolplayAppBestPerformers.mockResolvedValue({ data: [{ ...zeroRow }] })

    const result = await mod.fetchBestPerformers(
      [{ kind: 'rolplay-app-sql', clientId: 24 }, { kind: 'pharma', tenant: 'm8' }], 10, RANGE, null,
    )
    expect(result!.data[0].avg_score).toBe(0)
    expect(result!.data[0].pass_rate).toBe(0)
    expect(Number.isFinite(result!.data[0].avg_score)).toBe(true)
  })
})

describe('fetchTrends', () => {
  it('returns null for an empty source list', async () => {
    const mod = await fresh()
    expect(await mod.fetchTrends([], RANGE, null)).toBeNull()
  })

  it('merges matching score-distribution histogram buckets and recomputes pct from the new total', async () => {
    const mod = await fresh()
    pharmaDashboardTrends.mockResolvedValue({
      scoreTrend: [], passFailTrend: [], evalCountTrend: [],
      scoreDistribution: [{ range: '70-79', count: 3, pct: 100 }, { range: '90-100', count: 0, pct: 0 }],
    })
    rolplayAppTrends.mockResolvedValue({
      scoreTrend: [], passFailTrend: [], evalCountTrend: [],
      scoreDistribution: [{ range: '70-79', count: 1, pct: 100 }, { range: '90-100', count: 6, pct: 0 }],
    })

    const result = await mod.fetchTrends(
      [{ kind: 'rolplay-app-sql', clientId: 24 }, { kind: 'pharma', tenant: 'm8' }], RANGE, null,
    )
    const byRange = Object.fromEntries(result!.data.scoreDistribution!.map(b => [b.range, b]))
    expect(byRange['70-79'].count).toBe(4) // 3 + 1
    expect(byRange['90-100'].count).toBe(6) // 0 + 6
    expect(byRange['70-79'].pct).toBeCloseTo(40, 5) // 4/10
    expect(byRange['90-100'].pct).toBeCloseTo(60, 5) // 6/10
  })

  it('falls back to whichever source has a histogram rather than guessing, when bucket schemes do not match', async () => {
    const mod = await fresh()
    pharmaDashboardTrends.mockResolvedValue({
      scoreTrend: [], passFailTrend: [], evalCountTrend: [],
      scoreDistribution: [{ range: '0-49', count: 5, pct: 100 }], // a DIFFERENT bucket scheme
    })
    rolplayAppTrends.mockResolvedValue({ scoreTrend: [], passFailTrend: [], evalCountTrend: [] }) // no histogram at all

    const result = await mod.fetchTrends(
      [{ kind: 'rolplay-app-sql', clientId: 24 }, { kind: 'pharma', tenant: 'm8' }], RANGE, null,
    )
    expect(result!.data.scoreDistribution).toEqual([{ range: '0-49', count: 5, pct: 100 }])
  })

  it('omits scoreDistribution entirely when NEITHER source has one', async () => {
    const mod = await fresh()
    pharmaDashboardTrends.mockResolvedValue({ scoreTrend: [], passFailTrend: [], evalCountTrend: [] })
    rolplayAppTrends.mockResolvedValue({ scoreTrend: [], passFailTrend: [], evalCountTrend: [] })

    const result = await mod.fetchTrends(
      [{ kind: 'rolplay-app-sql', clientId: 24 }, { kind: 'pharma', tenant: 'm8' }], RANGE, null,
    )
    expect(result!.data.scoreDistribution).toBeUndefined()
  })

  it('handles a fully empty single source safely (no data at all)', async () => {
    const mod = await fresh()
    pharmaDashboardTrends.mockResolvedValue({ scoreTrend: [], passFailTrend: [], evalCountTrend: [] })
    const result = await mod.fetchTrends([{ kind: 'pharma', tenant: 'sanfer' }], RANGE, null)
    expect(result).toEqual({ data: { scoreTrend: [], passFailTrend: [], evalCountTrend: [] }, source: 'pharma-sanfer' })
  })
})
