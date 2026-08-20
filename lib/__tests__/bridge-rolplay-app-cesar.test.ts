/**
 * Cesar KPIs (Sugerencia de KPI's Cesar.xlsx), ported to the hand-built
 * dashboard's lib/bridge-rolplay-app.ts. Mirrors ai-service's Python
 * implementation exactly (verified byte-for-byte identical against real
 * live Siigo data) -- these tests exercise the same logic with the network
 * layer mocked.
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

describe('rolplayAppCesarGroup1', () => {
  it('computes activation rate, MAU, and readiness from real query shapes', async () => {
    const mod = await fresh()
    fetchSpy
      .mockResolvedValueOnce(respond([{ n: 20 }]))               // enrolled
      .mockResolvedValueOnce(respond([{ n: 10, sessions: 40, weeks: 4 }])) // active
      .mockResolvedValueOnce(respond([{ n: 5 }]))                // MAU
      .mockResolvedValueOnce(respond([]))                        // mastery aggregate (empty -> no mastery data)
      .mockResolvedValueOnce(respond([]))                        // seq rows (empty -> no delta)

    const result = await mod.rolplayAppCesarGroup1(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-07-01T00:00:00.000Z' })

    expect(result.activationRate).toBe(50)       // 10/20 * 100
    expect(result.mauRate).toBe(25)              // 5/20 * 100
    expect(result.weeklyPracticeFrequency).toBe(10) // 40/4
    expect(result.readinessIndex).toBe(0)
    expect(result.deltaScore).toBeNull()
    expect(result.masteryDistribution).toEqual([])
  })

  it('computes delta score and mastery distribution from a real per-user sequence', async () => {
    const mod = await fresh()
    fetchSpy
      .mockResolvedValueOnce(respond([{ n: 10 }])) // enrolled
      .mockResolvedValueOnce(respond([{ n: 5, sessions: 20, weeks: 2 }])) // active
      .mockResolvedValueOnce(respond([{ n: 2 }])) // MAU
      // Mastery bands + mastered-user count now come from a DB-side aggregate
      // over EVERY scored session in range, not from the bounded seq scan.
      // For scores {40, 60, 96, 80}: 2 basic, 1 intermediate, 1 advanced;
      // user 1 is the single mastered user.
      .mockResolvedValueOnce(respond([
        { basic: 2, intermediate: 1, advanced: 1, total_scored: 4, mastered_users: 1 },
      ]))
      .mockResolvedValueOnce(respond([
        { user_id: 1, sc: '40' }, { user_id: 1, sc: '60' }, { user_id: 1, sc: '96' }, // user 1: mastered on 3rd try, delta +56
        { user_id: 2, sc: '80' }, // user 2: single session, no delta
      ]))

    // range.toIso must be set -- otherwise the MAU query is skipped entirely
    // (not fetched at all), shifting the mocked-call queue by one.
    const result = await mod.rolplayAppCesarGroup1(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-07-01T00:00:00.000Z' })

    expect(result.deltaScore).toBe(56)        // only user 1 has >=2 sessions: 96-40
    expect(result.readinessIndex).toBe(10)    // 1 mastered / 10 enrolled * 100
    const advanced = result.masteryDistribution.find(b => b.label.startsWith('Advanced'))
    expect(advanced?.value).toBe(1) // only the 96
    expect(result.deltaScoreSampled).toBe(false) // 4 rows, nowhere near the cap
  })

  it('counts mastered users over the whole range, not just the bounded delta scan', async () => {
    // Regression: readinessIndex used to divide a 500-row-capped `mastered`
    // count by an UNCAPPED `enrolled`, so it silently trended toward 0% as a
    // tenant grew -- and because the scan is ORDER BY user_id it was always the
    // same lowest-numbered users, a systematic bias rather than a sample.
    // The mastery aggregate must be believed even when the seq scan sees less.
    const mod = await fresh()
    fetchSpy
      .mockResolvedValueOnce(respond([{ n: 1000 }]))                        // enrolled: large tenant
      .mockResolvedValueOnce(respond([{ n: 800, sessions: 4000, weeks: 4 }])) // active
      .mockResolvedValueOnce(respond([{ n: 600 }]))                         // MAU
      .mockResolvedValueOnce(respond([                                       // DB-side: 250 real mastered users
        { basic: 3000, intermediate: 1500, advanced: 500, total_scored: 5000, mastered_users: 250 },
      ]))
      .mockResolvedValueOnce(respond([                                       // seq scan sees only 2 of them
        { user_id: 1, sc: '40' }, { user_id: 1, sc: '96' },
      ]))

    const result = await mod.rolplayAppCesarGroup1(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-07-01T00:00:00.000Z' })

    // 250/1000, from the aggregate -- NOT 1/1000 from the truncated scan.
    expect(result.readinessIndex).toBe(25)
    const advanced = result.masteryDistribution.find(b => b.label.startsWith('Advanced'))
    expect(advanced?.value).toBe(500)
    expect(advanced?.pct).toBe(10) // 500/5000
  })

  it('flags deltaScore as sampled when the row cap is actually hit', async () => {
    const mod = await fresh()
    // 500 rows == _CLOSING_DATA_SAMPLE_LIMIT, i.e. the scan was truncated.
    const capped = Array.from({ length: 500 }, (_, i) => ({ user_id: Math.floor(i / 2) + 1, sc: String(50 + (i % 2) * 20) }))
    fetchSpy
      .mockResolvedValueOnce(respond([{ n: 400 }]))
      .mockResolvedValueOnce(respond([{ n: 300, sessions: 900, weeks: 3 }]))
      .mockResolvedValueOnce(respond([{ n: 200 }]))
      .mockResolvedValueOnce(respond([{ basic: 250, intermediate: 250, advanced: 0, total_scored: 500, mastered_users: 0 }]))
      .mockResolvedValueOnce(respond(capped))

    const result = await mod.rolplayAppCesarGroup1(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-07-01T00:00:00.000Z' })

    expect(result.deltaScoreSampled).toBe(true)
    expect(result.deltaScore).not.toBeNull() // still reported -- but flagged, never passed off as complete
  })

  it('returns null rates rather than dividing by zero when nothing is enrolled', async () => {
    const mod = await fresh()
    fetchSpy
      .mockResolvedValueOnce(respond([{ n: 0 }]))
      .mockResolvedValueOnce(respond([{ n: 0, sessions: 0, weeks: 0 }]))
      .mockResolvedValueOnce(respond([]))
      .mockResolvedValueOnce(respond([]))

    const result = await mod.rolplayAppCesarGroup1(29)
    expect(result.activationRate).toBeNull()
    expect(result.mauRate).toBeNull()
    expect(result.readinessIndex).toBeNull()
    expect(result.weeklyPracticeFrequency).toBeNull()
  })

})

describe('rolplayAppCommercialDomain', () => {
  it('discovers whatever bloque_*_score keys exist dynamically, averaged and sorted', async () => {
    const mod = await fresh()
    const sessionJson = (obj: Record<string, unknown>) => JSON.stringify(obj)
    fetchSpy.mockResolvedValueOnce(respond([
      { d: sessionJson({ bloque_crear_conexion_score: '60', bloque_obtener_si_score: '80' }) },
      { d: sessionJson({ bloque_crear_conexion_score: '70', bloque_obtener_si_score: '90' }) },
    ]))

    const { data: rows, sampled } = await mod.rolplayAppCommercialDomain(29)
    expect(rows[0]).toEqual({ domain: 'Obtener Si', avgScore: 85, sessions: 2 })
    expect(rows[1]).toEqual({ domain: 'Crear Conexion', avgScore: 65, sessions: 2 })
    expect(sampled).toBe(false)
  })

  it('returns empty for sessions with no bloque_* keys (matches Takeda: no raw_closing_data structure)', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: JSON.stringify({ overall_score: '80' }) }]))
    const { data: rows } = await mod.rolplayAppCommercialDomain(29)
    expect(rows).toEqual([])
  })

  it('skips rows with unparseable JSON rather than throwing', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: 'not json' }, { d: JSON.stringify({ bloque_x_score: '50' }) }]))
    const { data: rows } = await mod.rolplayAppCommercialDomain(29)
    expect(rows).toEqual([{ domain: 'X', avgScore: 50, sessions: 1 }])
  })

  it('flags sampled=true when the closing-data scan hits its row cap (bias risk, same class as the fixed deltaScore bug)', async () => {
    const mod = await fresh()
    const cap = 500 // matches _CLOSING_DATA_SAMPLE_LIMIT in lib/bridge-rolplay-app.ts
    const rows = Array.from({ length: cap }, () => ({ d: JSON.stringify({ bloque_x_score: '50' }) }))
    fetchSpy.mockResolvedValueOnce(respond(rows))
    const { sampled } = await mod.rolplayAppCommercialDomain(29)
    expect(sampled).toBe(true)
  })
})

describe('rolplayAppRubricaTags', () => {
  it('counts passed items for top strengths', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([
      { d: JSON.stringify({ rubrica_p1_nombre: 'Saluda cordialmente', rubrica_p1_cumplido: 'true' }) },
      { d: JSON.stringify({ rubrica_p1_nombre: 'Saluda cordialmente', rubrica_p1_cumplido: 'true' }) },
      { d: JSON.stringify({ rubrica_p1_nombre: 'Saluda cordialmente', rubrica_p1_cumplido: 'false' }) },
    ]))
    const { data: rows } = await mod.rolplayAppRubricaTags(29, true)
    expect(rows).toEqual([{ item: 'Saluda cordialmente', count: 2 }])
  })

  it('counts failed items for top opportunities', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([
      { d: JSON.stringify({ rubrica_p1_nombre: 'Cierra la venta', rubrica_p1_cumplido: 'false' }) },
      { d: JSON.stringify({ rubrica_p1_nombre: 'Cierra la venta', rubrica_p1_cumplido: 'false' }) },
    ]))
    const { data: rows } = await mod.rolplayAppRubricaTags(29, false)
    expect(rows).toEqual([{ item: 'Cierra la venta', count: 2 }])
  })

  it('discovers any number of rubrica items, not hardcoded to 24', async () => {
    const mod = await fresh()
    const obj: Record<string, string> = {}
    for (let i = 1; i <= 30; i++) {
      obj[`rubrica_p${i}_nombre`] = `Item ${i}`
      obj[`rubrica_p${i}_cumplido`] = 'true'
    }
    fetchSpy.mockResolvedValueOnce(respond([{ d: JSON.stringify(obj) }]))
    const { data: rows } = await mod.rolplayAppRubricaTags(29, true)
    expect(rows.length).toBe(10) // capped at top 10, all 30 discovered/counted
  })

  it('ignores N/A cumplido values', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: JSON.stringify({ rubrica_p1_nombre: 'Item', rubrica_p1_cumplido: 'N/A' }) }]))
    const { data: rows } = await mod.rolplayAppRubricaTags(29, true)
    expect(rows).toEqual([])
  })

  it('skips a non-string rubrica label instead of stringifying it into a garbage row', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([
      { d: JSON.stringify({ rubrica_p1_nombre: { nested: 'object' }, rubrica_p1_cumplido: 'true' }) },
    ]))
    const { data: rows } = await mod.rolplayAppRubricaTags(29, true)
    expect(rows).toEqual([])
  })
})

describe('rolplayAppAdoptionMovementRate', () => {
  it('computes the % of sessions with a positive intent movement', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([
      { d: JSON.stringify({ intencion_movement: 'Subió' }) },
      { d: JSON.stringify({ intencion_movement: 'Subió' }) },
      { d: JSON.stringify({ intencion_movement: 'Bajó' }) },
    ]))
    const { value: rate } = await mod.rolplayAppAdoptionMovementRate(29)
    expect(rate).toBe(66.7)
  })

  it('returns null (not a fabricated 0) when no session carries the field', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: JSON.stringify({ overall_score: '80' }) }]))
    const { value: rate } = await mod.rolplayAppAdoptionMovementRate(29)
    expect(rate).toBeNull()
  })

  it('returns null for no sessions at all', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([]))
    const { value: rate } = await mod.rolplayAppAdoptionMovementRate(29)
    expect(rate).toBeNull()
  })
})
