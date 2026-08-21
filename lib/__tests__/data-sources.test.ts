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
const pharmaDashboardOverview = vi.fn()

vi.mock('../bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('../bridge-rolplay-app')>('../bridge-rolplay-app')
  return {
    ...actual, // mergeOverviewSources stays real -- it's the thing under test alongside resolution/composition
    resolveRolplayAppAccess: (...args: unknown[]) => resolveRolplayAppAccess(...args),
    rolplayAppOverview: (...args: unknown[]) => rolplayAppOverview(...args),
  }
})
vi.mock('../bridge-pharma-analytics', () => ({
  pharmaDashboardOverview: (...args: unknown[]) => pharmaDashboardOverview(...args),
}))

async function fresh() {
  vi.resetModules()
  return import('../data-sources')
}

const RANGE = { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-06-08T00:00:00.000Z', prevFromIso: '2026-05-25T00:00:00.000Z', prevToIso: '2026-05-31T23:59:59.999Z' }

beforeEach(() => {
  resolveRolplayAppAccess.mockReset()
  rolplayAppOverview.mockReset()
  pharmaDashboardOverview.mockReset()
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
