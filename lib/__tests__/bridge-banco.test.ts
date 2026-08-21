/**
 * Regression coverage for the "totalSessions undercounts real sessions" bug
 * found during the KPI audit: bridgeBancoKpis's summary/top-performers
 * queries INNER JOINed to a saved_reports_options rounds subquery, so any
 * session with ZERO rounds (no rows in that child table) was silently
 * dropped from total_sessions/active_banco_users/avg_rounds_per_session and
 * from a rep's session count in topPerformers -- while the sibling
 * sessionsByPosition query (no rounds join at all) and bridgeBancoSessions
 * (LEFT JOIN) counted the very same sessions. For an identical date range,
 * the dashboard could show sessionsByPosition summing to MORE than
 * totalSessions for the same tenant -- unexplainable from the underlying
 * data. Fixed by switching both queries to LEFT JOIN + COALESCE(...,0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchSpy = vi.fn()

async function fresh() {
  vi.resetModules()
  process.env.BRIDGE_URL = 'https://bridge.test/exec'
  process.env.BRIDGE_SECRET = 'secret'
  return import('../bridge-banco')
}

function respond(data: unknown[]) {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

const capturedSql: string[] = []
function captureAndRespond(rowsBySqlFragment: { match: string; rows: unknown[] }[]) {
  fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
    const { sql } = JSON.parse(String(init.body))
    capturedSql.push(sql)
    const hit = rowsBySqlFragment.find(r => sql.includes(r.match))
    return respond(hit ? hit.rows : [])
  })
}

beforeEach(() => {
  fetchSpy.mockReset()
  capturedSql.length = 0
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.BRIDGE_URL
  delete process.env.BRIDGE_SECRET
})

describe('bridgeBancoKpis — zero-round sessions must still count', () => {
  it('uses a LEFT JOIN (not INNER JOIN) for the overall summary, so a session with zero rounds is not dropped', async () => {
    const mod = await fresh()
    captureAndRespond([
      { match: 'active_banco_users', rows: [{ total_sessions: 3, active_banco_users: 2, avg_rounds_per_session: 1.7 }] },
    ])
    await mod.bridgeBancoKpis({ fromIso: '2026-08-01T00:00:00.000Z', toIso: '2026-08-31T00:00:00.000Z' })

    const summarySql = capturedSql.find(s => s.includes('active_banco_users'))!
    expect(summarySql).toContain('LEFT JOIN (')
    // Every "JOIN (" onto the rounds subquery must be a LEFT JOIN -- a bare
    // "JOIN (" (INNER) is exactly the bug this regression guards against.
    expect((summarySql.match(/JOIN \(/g) ?? []).length).toBe((summarySql.match(/LEFT JOIN \(/g) ?? []).length)
    expect(summarySql).toContain('COALESCE(rnd.round_count, 0)')
  })

  it('uses a LEFT JOIN for top performers too, for the same reason', async () => {
    const mod = await fresh()
    captureAndRespond([
      { match: 'GROUP BY bu.ID, bu.name, bu.position', rows: [{ employee_name: 'Ana', position: 'REGIONAL', sessions: 3, avg_rounds: 1.7 }] },
    ])
    await mod.bridgeBancoKpis({ fromIso: '2026-08-01T00:00:00.000Z', toIso: '2026-08-31T00:00:00.000Z' })

    const topSql = capturedSql.find(s => s.includes('GROUP BY bu.ID, bu.name, bu.position'))!
    expect(topSql).toContain('LEFT JOIN (')
    expect(topSql).toContain('COALESCE(rnd.round_count, 0)')
  })

  it('manually-calculated example: 3 sessions where 1 has zero rounds now surfaces total_sessions=3, matching sessionsByPosition', async () => {
    // Real-shape example: rep has 3 sessions in the period; 2 have rounds
    // (2 and 3 -> avg 2.5 over those two), 1 has zero rounds. The bridge/DB
    // is mocked to already reflect the LEFT JOIN's correct aggregate ---
    // this test locks in that bridge-banco.ts trusts and surfaces that
    // aggregate verbatim (no client-side re-derivation that could
    // reintroduce the drop).
    const mod = await fresh()
    captureAndRespond([
      { match: 'active_banco_users', rows: [{ total_sessions: 3, active_banco_users: 1, avg_rounds_per_session: 1.7 }] }, // (2+3+0)/3 = 1.67 -> 1.7
      { match: 'GROUP BY bu.position', rows: [{ position: 'REGIONAL', sessions: 3 }] },
    ])
    const kpis = await mod.bridgeBancoKpis({ fromIso: '2026-08-01T00:00:00.000Z', toIso: '2026-08-31T00:00:00.000Z' })

    expect(kpis.totalSessions).toBe(3)
    expect(kpis.avgRoundsPerSession).toBe(1.7)
    // The two independent "total sessions" figures now agree for the same period.
    const bySeatSum = kpis.sessionsByPosition.reduce((sum, p) => sum + p.sessions, 0)
    expect(bySeatSum).toBe(kpis.totalSessions)
  })
})
