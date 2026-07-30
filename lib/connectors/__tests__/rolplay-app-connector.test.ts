/**
 * The adapter's contract: it restructures access WITHOUT changing any number.
 *
 * These tests mock lib/bridge-rolplay-app (the verified module) and assert the
 * connector passes arguments through faithfully and reports values unmodified.
 * That is the property that makes this refactor safe to land — the figures on
 * these dashboards are checked against real client data, so an abstraction that
 * quietly alters one would be worse than no abstraction.
 *
 * Also pinned: null NEVER becomes 0, and unsupported capabilities are absent
 * rather than empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveRolplayAppAccess = vi.fn()
const rolplayAppAvailableModules = vi.fn()
const rolplayAppOverview = vi.fn()
const rolplayAppUsecaseBreakdown = vi.fn()
const rolplayAppBestPerformers = vi.fn()
const rolplayAppDataBounds = vi.fn()

vi.mock('../../bridge-rolplay-app', () => ({
  resolveRolplayAppAccess: (...a: unknown[]) => resolveRolplayAppAccess(...a),
  rolplayAppAvailableModules: (...a: unknown[]) => rolplayAppAvailableModules(...a),
  rolplayAppOverview: (...a: unknown[]) => rolplayAppOverview(...a),
  rolplayAppUsecaseBreakdown: (...a: unknown[]) => rolplayAppUsecaseBreakdown(...a),
  rolplayAppBestPerformers: (...a: unknown[]) => rolplayAppBestPerformers(...a),
  rolplayAppDataBounds: (...a: unknown[]) => rolplayAppDataBounds(...a),
}))

const RANGE = { fromIso: '2026-01-01T00:00:00Z', toIso: '2026-06-30T00:00:00Z' }
const CTX = { email: 'rep@m8.test' }

const OVERVIEW = {
  totalEvaluations: 772,
  avgScore: 61.03,
  passRate: 64.51,
  passedEvaluations: 498,
  prevTotalEvaluations: 700,
  prevAvgScore: 59.1,
  prevPassRate: 60.0,
}

async function load() {
  vi.resetModules()
  return import('../rolplay-app-connector')
}

beforeEach(() => {
  for (const m of [
    resolveRolplayAppAccess, rolplayAppAvailableModules, rolplayAppOverview,
    rolplayAppUsecaseBreakdown, rolplayAppBestPerformers, rolplayAppDataBounds,
  ]) m.mockReset()

  resolveRolplayAppAccess.mockResolvedValue(42)
  rolplayAppAvailableModules.mockResolvedValue(['coach', 'simulator'])
  rolplayAppOverview.mockResolvedValue(OVERVIEW)
  rolplayAppUsecaseBreakdown.mockResolvedValue({ data: [] })
  rolplayAppBestPerformers.mockResolvedValue({ data: [] })
  rolplayAppDataBounds.mockResolvedValue({ min: '2020-01-01', max: '2026-07-01' })
})

describe('capabilities', () => {
  it('reports only the modules the backend actually has data for', async () => {
    const { rolplayAppConnector } = await load()

    const caps = await rolplayAppConnector.capabilities(CTX)

    expect(caps.modules).toEqual(['coach', 'simulator'])
    expect(caps.drilldown).toBe(true)
  })

  it('reports journey as unsupported — this schema has no completion concept', async () => {
    const { rolplayAppConnector } = await load()

    // Claiming journey support would produce invented percentages.
    expect((await rolplayAppConnector.capabilities(CTX)).journey).toBe(false)
  })

  it('returns nothing for a tenant with no mapped client', async () => {
    resolveRolplayAppAccess.mockResolvedValue(null)
    const { rolplayAppConnector } = await load()

    const caps = await rolplayAppConnector.capabilities({ email: 'nobody@unknown.test' })

    expect(caps.modules).toEqual([])
    expect(caps.metrics).toEqual([])
  })
})

describe('unsupported methods are ABSENT, not empty', () => {
  it('omits discover/schema/progress entirely', async () => {
    const { rolplayAppConnector } = await load()

    // A caller must be able to distinguish "cannot introspect" from "found
    // nothing". Stubs returning {} would erase that distinction.
    expect(rolplayAppConnector.discover).toBeUndefined()
    expect(rolplayAppConnector.schema).toBeUndefined()
    expect(rolplayAppConnector.progress).toBeUndefined()
  })
})

describe('metrics — equivalence with the underlying module', () => {
  it('passes range and module straight through', async () => {
    const { rolplayAppConnector } = await load()

    await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['sessions.total'],
      range: RANGE,
      module: 'coach',
    })

    expect(rolplayAppOverview).toHaveBeenCalledWith(42, RANGE, 'coach')
  })

  it('passes null (not undefined) when no module is selected', async () => {
    const { rolplayAppConnector } = await load()

    await rolplayAppConnector.metrics!(CTX, { metricIds: ['sessions.total'], range: RANGE })

    expect(rolplayAppOverview).toHaveBeenCalledWith(42, RANGE, null)
  })

  it('reports values byte-identical to the source', async () => {
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['sessions.total', 'score.average', 'pass.rate', 'sessions.passed'],
      range: RANGE,
    })
    const byId = Object.fromEntries(res.values.map(v => [v.metricId, v]))

    // No rounding, rescaling or unit conversion may happen in the adapter.
    expect(byId['sessions.total'].value).toBe(772)
    expect(byId['score.average'].value).toBe(61.03)
    expect(byId['pass.rate'].value).toBe(64.51)
    expect(byId['sessions.passed'].value).toBe(498)
  })

  it('carries the previous-period values through', async () => {
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['sessions.total', 'score.average'],
      range: RANGE,
    })
    const byId = Object.fromEntries(res.values.map(v => [v.metricId, v]))

    expect(byId['sessions.total'].previousValue).toBe(700)
    expect(byId['score.average'].previousValue).toBe(59.1)
  })

  it('keeps null as null and says why — never 0', async () => {
    rolplayAppOverview.mockResolvedValue({
      ...OVERVIEW, avgScore: null, passRate: null,
    })
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['score.average', 'pass.rate'],
      range: RANGE,
    })

    for (const v of res.values) {
      // Coercing these to 0 has produced real incorrect dashboards.
      expect(v.value).toBeNull()
      expect(v.nullReason).toBeTruthy()
    }
  })

  it('flags an unknown metric id instead of dropping it', async () => {
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['sessions.total', 'revenue.total'],
      range: RANGE,
    })

    // Length preserved so a caller can match request to response by position.
    expect(res.values).toHaveLength(2)
    expect(res.values[1].nullReason).toContain('Unsupported metric')
  })

  it('returns nulls with a reason when the tenant has no client id', async () => {
    resolveRolplayAppAccess.mockResolvedValue(null)
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(
      { email: 'x@unknown.test' },
      { metricIds: ['sessions.total'], range: RANGE },
    )

    expect(res.values[0].value).toBeNull()
    expect(rolplayAppOverview).not.toHaveBeenCalled()
  })
})

describe('grouping', () => {
  it('groups by usecase using the real display name', async () => {
    rolplayAppUsecaseBreakdown.mockResolvedValue({
      data: [
        { usecaseId: 7, usecase_name: 'Objection Handling', totalEvaluations: 30, avgScore: 71.5, passRate: 80, passed: 24 },
      ],
    })
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['sessions.total'], range: RANGE, groupBy: 'usecase',
    })

    expect(res.groups?.[0].label).toBe('Objection Handling')
    expect(res.groups?.[0].values[0].value).toBe(30)
  })

  it('falls back to the id rather than rendering a null label', async () => {
    rolplayAppUsecaseBreakdown.mockResolvedValue({
      data: [{ usecaseId: 9, usecase_name: null, totalEvaluations: 5, avgScore: null, passRate: null, passed: 0 }],
    })
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['sessions.total'], range: RANGE, groupBy: 'usecase',
    })

    expect(res.groups?.[0].label).toBe('Use case 9')
  })

  it('returns empty groups for an unsupported dimension', async () => {
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.metrics!(CTX, {
      metricIds: ['sessions.total'], range: RANGE, groupBy: 'region',
    })

    expect(res.groups).toEqual([])
    expect(rolplayAppUsecaseBreakdown).not.toHaveBeenCalled()
  })
})

describe('health', () => {
  it('probes with a query that exercises tenant scoping', async () => {
    const { rolplayAppConnector } = await load()

    const h = await rolplayAppConnector.health(CTX)

    expect(h.ok).toBe(true)
    // A transport-only ping would report healthy while every real call failed.
    expect(rolplayAppDataBounds).toHaveBeenCalledWith(42)
  })

  it('reports not-ok instead of throwing when upstream fails', async () => {
    rolplayAppDataBounds.mockRejectedValue(new Error('SQL HTTP 500'))
    const { rolplayAppConnector } = await load()

    const h = await rolplayAppConnector.health(CTX)

    expect(h.ok).toBe(false)
    expect(h.detail).toContain('SQL HTTP 500')
  })

  it('reports not-ok for an unmapped tenant', async () => {
    resolveRolplayAppAccess.mockResolvedValue(null)
    const { rolplayAppConnector } = await load()

    expect((await rolplayAppConnector.health({ email: 'x@nope.test' })).ok).toBe(false)
  })
})

describe('drilldowns', () => {
  it('identifies a row by email when the name is missing', async () => {
    rolplayAppBestPerformers.mockResolvedValue({
      data: [{ user_email: 'a@m8.test', user_name: null, sessions: 12, avg_score: 70, pass_rate: 80 }],
    })
    const { rolplayAppConnector } = await load()

    const res = await rolplayAppConnector.drilldowns!(CTX, { range: RANGE })

    expect(res.rows[0].user).toBe('a@m8.test')
  })

  it('clamps an absurd limit rather than forwarding it', async () => {
    const { rolplayAppConnector } = await load()

    await rolplayAppConnector.drilldowns!(CTX, { range: RANGE, limit: 100_000 })

    const limitArg = rolplayAppBestPerformers.mock.calls[0][1]
    expect(limitArg).toBeLessThanOrEqual(500)
  })

  it('clamps a nonsensical limit up to at least 1', async () => {
    const { rolplayAppConnector } = await load()

    await rolplayAppConnector.drilldowns!(CTX, { range: RANGE, limit: 0 })

    expect(rolplayAppBestPerformers.mock.calls[0][1]).toBeGreaterThanOrEqual(1)
  })
})

describe('dimensions', () => {
  it('lists every usecase, unfiltered by the selected window', async () => {
    rolplayAppUsecaseBreakdown.mockResolvedValue({
      data: [{ usecaseId: 1, usecase_name: 'A', totalEvaluations: 4, avgScore: 1, passRate: 1, passed: 1 }],
    })
    const { rolplayAppConnector } = await load()

    const members = await rolplayAppConnector.dimensions!(CTX, 'usecase')

    expect(members).toEqual([{ key: '1', label: 'A', count: 4 }])
    // Called with no range — a filter list must show all options, not just
    // those active in the current window.
    expect(rolplayAppUsecaseBreakdown).toHaveBeenCalledWith(42)
  })

  it('returns empty for an unknown dimension', async () => {
    const { rolplayAppConnector } = await load()

    expect(await rolplayAppConnector.dimensions!(CTX, 'region')).toEqual([])
  })
})
