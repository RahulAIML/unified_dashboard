/**
 * Regression: rolplayAppOverview's previous-period window ended exactly ON
 * the current period's `fromIso` (`prevRange.toIso = range.fromIso`), and
 * dateClause()'s BETWEEN bound is inclusive on both ends -- so a session
 * falling exactly at the boundary instant would be counted in BOTH the
 * current period and the "previous" period, inflating both and distorting
 * the period-over-period delta. Fixed to end the previous window 1ms before
 * `fromIso`, matching the same pattern already used correctly in
 * app/api/dashboard/cesar-kpis/route.ts and the pharma branch of
 * app/api/dashboard/overview/route.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchSpy = vi.fn()

async function fresh() {
  vi.resetModules()
  process.env.ROLPLAY_APP_SQL_URL = 'https://sql.test/exec'
  return import('../bridge-rolplay-app')
}

function respond(data: unknown[]) {
  return new Response(JSON.stringify({ result: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('rolplayAppOverview — previous-period boundary', () => {
  it("ends the previous period's SQL clause the second BEFORE the current period starts, never overlapping", async () => {
    const mod = await fresh()
    const sqlCalls: string[] = []
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      sqlCalls.push(body.sql)
      return respond([{ total: 10, scored: 10, avg_score: '80', passed: 5 }])
    })

    await mod.rolplayAppOverview(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-06-08T00:00:00.000Z' })

    expect(sqlCalls).toHaveLength(2)
    const [currentSql, prevSql] = sqlCalls
    // Current period starts exactly at fromIso.
    expect(currentSql).toContain("BETWEEN '2026-06-01 00:00:00'")
    // Previous period must end the second BEFORE fromIso, not AT fromIso --
    // this is the actual fix. It must never contain the literal boundary
    // instant '2026-06-01 00:00:00' as its END bound.
    expect(prevSql).toContain("AND '2026-05-31 23:59:59'")
    expect(prevSql).not.toContain("AND '2026-06-01 00:00:00'")
  })

  it('keeps the previous period the same length as the current one', async () => {
    const mod = await fresh()
    const sqlCalls: string[] = []
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      sqlCalls.push(body.sql)
      return respond([{ total: 10, scored: 10, avg_score: '80', passed: 5 }])
    })

    // A 7-day current period (Jun 1 00:00 -> Jun 8 00:00).
    await mod.rolplayAppOverview(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-06-08T00:00:00.000Z' })

    const prevSql = sqlCalls[1]
    // Previous period should be the same 7-day span, ending May 31 23:59:59:
    // May 25 00:00:00 -> May 31 23:59:59.
    expect(prevSql).toContain("BETWEEN '2026-05-25 00:00:00' AND '2026-05-31 23:59:59'")
  })
})

describe('mergeOverviewSources — M8 pharma + rolplay_app_sql composition', () => {
  it('sums counts and weight-averages rates by each source\'s totalEvaluations', async () => {
    const mod = await fresh()
    const merged = mod.mergeOverviewSources(
      { totalEvaluations: 100, prevTotalEvaluations: 90, avgScore: 80, prevAvgScore: 78, passRate: 70, prevPassRate: 65, passedEvaluations: 70 },
      { totalEvaluations: 50,  prevTotalEvaluations: 10, avgScore: 90, prevAvgScore: 85, passRate: 90, prevPassRate: 80, passedEvaluations: 45 },
    )
    expect(merged.totalEvaluations).toBe(150)
    expect(merged.prevTotalEvaluations).toBe(100)
    expect(merged.passedEvaluations).toBe(115)
    // (80*100 + 90*50) / 150 = 83.33... -> 83.3
    expect(merged.avgScore).toBeCloseTo(83.3, 1)
    // (70*100 + 90*50) / 150 = 76.66... -> 76.7
    expect(merged.passRate).toBeCloseTo(76.7, 1)
  })

  it('excludes a null rate from the source rather than treating it as zero', async () => {
    const mod = await fresh()
    // Secondary source has real sessions but none scored yet (avgScore/passRate
    // null) -- must not drag the merged rate toward zero.
    const merged = mod.mergeOverviewSources(
      { totalEvaluations: 100, prevTotalEvaluations: 90, avgScore: 80, prevAvgScore: 78, passRate: 70, prevPassRate: 65, passedEvaluations: 70 },
      { totalEvaluations: 20,  prevTotalEvaluations: 0,  avgScore: null, prevAvgScore: null, passRate: null, prevPassRate: null, passedEvaluations: 0 },
    )
    expect(merged.totalEvaluations).toBe(120)
    expect(merged.avgScore).toBe(80)
    expect(merged.passRate).toBe(70)
  })

  it('returns null when both sources have no scored sessions at all', async () => {
    const mod = await fresh()
    const merged = mod.mergeOverviewSources(
      { totalEvaluations: 5, prevTotalEvaluations: 0, avgScore: null, prevAvgScore: null, passRate: null, prevPassRate: null, passedEvaluations: 0 },
      { totalEvaluations: 3, prevTotalEvaluations: 0, avgScore: null, prevAvgScore: null, passRate: null, prevPassRate: null, passedEvaluations: 0 },
    )
    expect(merged.avgScore).toBeNull()
    expect(merged.passRate).toBeNull()
  })

  it('takes passRateLegend from whichever side actually has one, when it is the first argument', async () => {
    const mod = await fresh()
    const merged = mod.mergeOverviewSources(
      { totalEvaluations: 10, prevTotalEvaluations: 0, avgScore: 80, prevAvgScore: null, passRate: 70, prevPassRate: null, passedEvaluations: 7, passRateLegend: 'Pass threshold: score >= 70 pts' },
      { totalEvaluations: 5,  prevTotalEvaluations: 0, avgScore: 90, prevAvgScore: null, passRate: 90, prevPassRate: null, passedEvaluations: 4 },
    )
    expect(merged.passRateLegend).toBe('Pass threshold: score >= 70 pts')
  })

  it('takes passRateLegend from whichever side actually has one, even when it is the SECOND argument (order-independent)', async () => {
    // This is the real production shape once rolplay_app_sql is composed as
    // the preferred/primary source (lib/data-sources.ts orders it first):
    // the pharma tenant's configured legend must still win even though
    // pharma's data is now the second argument, not the first.
    const mod = await fresh()
    const merged = mod.mergeOverviewSources(
      { totalEvaluations: 5,  prevTotalEvaluations: 0, avgScore: 90, prevAvgScore: null, passRate: 90, prevPassRate: null, passedEvaluations: 4 },
      { totalEvaluations: 10, prevTotalEvaluations: 0, avgScore: 80, prevAvgScore: null, passRate: 70, prevPassRate: null, passedEvaluations: 7, passRateLegend: 'Pass threshold: score >= 70 pts' },
    )
    expect(merged.passRateLegend).toBe('Pass threshold: score >= 70 pts')
  })
})
