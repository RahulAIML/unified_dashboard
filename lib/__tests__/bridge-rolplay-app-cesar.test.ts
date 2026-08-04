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
      .mockResolvedValueOnce(respond([]))                        // seq rows (empty -> no mastery data)

    const result = await mod.rolplayAppCesarGroup1(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-07-01T00:00:00.000Z' })

    expect(result.activationRate).toBe(50)       // 10/20 * 100
    expect(result.mauRate).toBe(25)              // 5/20 * 100
    expect(result.weeklyPracticeFrequency).toBe(10) // 40/4
    expect(result.readinessIndex).toBe(0)
    expect(result.practicesToMastery).toBeNull()
    expect(result.deltaScore).toBeNull()
    expect(result.masteryDistribution).toEqual([])
  })

  it('computes delta score and mastery distribution from a real per-user sequence', async () => {
    const mod = await fresh()
    fetchSpy
      .mockResolvedValueOnce(respond([{ n: 10 }])) // enrolled
      .mockResolvedValueOnce(respond([{ n: 5, sessions: 20, weeks: 2 }])) // active
      .mockResolvedValueOnce(respond([{ n: 2 }])) // MAU
      .mockResolvedValueOnce(respond([
        { user_id: 1, sc: '40' }, { user_id: 1, sc: '60' }, { user_id: 1, sc: '96' }, // user 1: mastered on 3rd try, delta +56
        { user_id: 2, sc: '80' }, // user 2: single session, no delta
      ]))

    // range.toIso must be set -- otherwise the MAU query is skipped entirely
    // (not fetched at all), shifting the mocked-call queue by one.
    const result = await mod.rolplayAppCesarGroup1(29, { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-07-01T00:00:00.000Z' })

    expect(result.deltaScore).toBe(56)        // only user 1 has >=2 sessions: 96-40
    expect(result.practicesToMastery).toBe(3) // user 1 hit mastery on their 3rd session
    expect(result.readinessIndex).toBe(10)    // 1 mastered / 10 enrolled * 100
    const advanced = result.masteryDistribution.find(b => b.label.startsWith('Advanced'))
    expect(advanced?.value).toBe(1) // only the 96
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

    const rows = await mod.rolplayAppCommercialDomain(29)
    expect(rows[0]).toEqual({ domain: 'Obtener Si', avgScore: 85, sessions: 2 })
    expect(rows[1]).toEqual({ domain: 'Crear Conexion', avgScore: 65, sessions: 2 })
  })

  it('returns empty for sessions with no bloque_* keys (matches Takeda: no raw_closing_data structure)', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: JSON.stringify({ overall_score: '80' }) }]))
    const rows = await mod.rolplayAppCommercialDomain(29)
    expect(rows).toEqual([])
  })

  it('skips rows with unparseable JSON rather than throwing', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: 'not json' }, { d: JSON.stringify({ bloque_x_score: '50' }) }]))
    const rows = await mod.rolplayAppCommercialDomain(29)
    expect(rows).toEqual([{ domain: 'X', avgScore: 50, sessions: 1 }])
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
    const rows = await mod.rolplayAppRubricaTags(29, true)
    expect(rows).toEqual([{ item: 'Saluda cordialmente', count: 2 }])
  })

  it('counts failed items for top opportunities', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([
      { d: JSON.stringify({ rubrica_p1_nombre: 'Cierra la venta', rubrica_p1_cumplido: 'false' }) },
      { d: JSON.stringify({ rubrica_p1_nombre: 'Cierra la venta', rubrica_p1_cumplido: 'false' }) },
    ]))
    const rows = await mod.rolplayAppRubricaTags(29, false)
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
    const rows = await mod.rolplayAppRubricaTags(29, true)
    expect(rows.length).toBe(10) // capped at top 10, all 30 discovered/counted
  })

  it('ignores N/A cumplido values', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: JSON.stringify({ rubrica_p1_nombre: 'Item', rubrica_p1_cumplido: 'N/A' }) }]))
    const rows = await mod.rolplayAppRubricaTags(29, true)
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
    const rate = await mod.rolplayAppAdoptionMovementRate(29)
    expect(rate).toBe(66.7)
  })

  it('returns null (not a fabricated 0) when no session carries the field', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([{ d: JSON.stringify({ overall_score: '80' }) }]))
    const rate = await mod.rolplayAppAdoptionMovementRate(29)
    expect(rate).toBeNull()
  })

  it('returns null for no sessions at all', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValueOnce(respond([]))
    const rate = await mod.rolplayAppAdoptionMovementRate(29)
    expect(rate).toBeNull()
  })
})
