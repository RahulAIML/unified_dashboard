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
