/**
 * Regression coverage for rolplayAppDrilldown -- the two queries the
 * platform owner uses manually to build a session summary report
 * (r_user_session joined to user/simulator names, plus every
 * r_user_session_details row ordered by sequence), now wired into the
 * shared /drilldown/[id] page every dashboard (hand-built and AI-Builder
 * generated) already links to. rolplay_app_sql tenants previously had NO
 * working drilldown at all -- clicking a session row fell through to
 * getDrilldown (the coach_app_sql path), which queries the wrong tables
 * entirely for these tenants.
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
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ROLPLAY_APP_SQL_URL
})

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    ID: 78,
    user_id: 284,
    simulator_id: 3092,
    date_created: '2026-04-13 14:51:54',
    closing_analysis: null,
    raw_closing_data: null,
    user_name: 'Mario Zenteno',
    simulator_name: 'Demo Besins Inovocare Evaluador',
    extracted_score: '85',
    ...overrides,
  }
}

describe('rolplayAppDrilldown — tenant scoping', () => {
  it('scopes the session lookup to the given client_id, so a session id from another tenant returns null', async () => {
    const mod = await fresh()
    const sqlCalls: string[] = []
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      sqlCalls.push(body.sql)
      return respond([]) // no row found for this client_id
    })

    const result = await mod.rolplayAppDrilldown(78, 29)

    expect(result).toBeNull()
    expect(sqlCalls[0]).toContain('u.client_id = 29')
    expect(sqlCalls[0]).toContain('s.ID = 78')
  })

  it('aliases r_user_session as `s` (not `us`), matching what SCORE_SQL hardcodes -- a real live bug where `s` resolved to r_simulator instead, breaking every drilldown with a SQL error', async () => {
    const mod = await fresh()
    const sqlCalls: string[] = []
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      sqlCalls.push(body.sql)
      return respond([sessionRow()])
    })

    await mod.rolplayAppDrilldown(78, 29)

    expect(sqlCalls[0]).toContain('FROM r_user_session s')
    expect(sqlCalls[0]).not.toContain('FROM r_user_session us')
  })

  it('rejects a non-positive session id before ever querying the bridge', async () => {
    const mod = await fresh()
    await expect(mod.rolplayAppDrilldown(0, 29)).rejects.toThrow(/invalid session id/)
    await expect(mod.rolplayAppDrilldown(-5, 29)).rejects.toThrow(/invalid session id/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('rolplayAppDrilldown — session summary fields', () => {
  it('produces overall_score/overall_result fields matching lib/field-map.ts CORE_FIELD_MAP, so the page shows the hero score/result', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow({ extracted_score: '85' })])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)

    expect(result?.savedReportId).toBe(78)
    expect(result?.usecaseId).toBe(3092)
    expect(result?.date).toBe('2026-04-13')
    const score = result?.fields.find(f => f.fieldKey === 'overall_score')
    const outcome = result?.fields.find(f => f.fieldKey === 'overall_result')
    expect(score?.normalizedValue).toBe(85)
    expect(outcome?.normalizedValue).toBe('Aprobado')
  })

  it('marks a below-threshold score as Deficiente, matching the module-wide 70pt convention', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow({ extracted_score: '50' })])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    const outcome = result?.fields.find(f => f.fieldKey === 'overall_result')
    expect(outcome?.normalizedValue).toBe('Deficiente')
  })

  it('emits no score/result field at all when the session has no extractable score, rather than fabricating one', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow({ extracted_score: null })])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    expect(result?.fields.find(f => f.fieldKey === 'overall_score')).toBeUndefined()
    expect(result?.fields.find(f => f.fieldKey === 'overall_result')).toBeUndefined()
  })
})

describe('rolplayAppDrilldown — per-turn transcript', () => {
  it('turns r_user_session_details rows into question_N/answer_N/retro_N fields, ordered by sequence, matching app/drilldown/[id]/page.tsx\'s own groupInteractions() regex', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) {
        return respond([
          { sequence: 1, ai_text: 'Hola! Empecemos.', user_text: 'hola', retro_analysis: null },
          { sequence: 2, ai_text: 'Segunda pregunta', user_text: 'segunda respuesta', retro_analysis: 'Buen intento' },
        ])
      }
      return respond([sessionRow()])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    const byKey = Object.fromEntries((result?.fields ?? []).map(f => [f.fieldKey, f.normalizedValue]))

    expect(byKey['question_1']).toBe('Hola! Empecemos.')
    expect(byKey['answer_1']).toBe('hola')
    expect(byKey['question_2']).toBe('Segunda pregunta')
    expect(byKey['answer_2']).toBe('segunda respuesta')
    expect(byKey['retro_2']).toBe('Buen intento')
    // No fabricated field for a turn with no retro_analysis.
    expect(byKey['retro_1']).toBeUndefined()
  })

  it('returns an empty transcript (not an error) for a session with no detail rows', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow()])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    expect(result).not.toBeNull()
    expect(result?.fields.some(f => f.fieldKey.startsWith('question_'))).toBe(false)
  })
})

describe('rolplayAppDrilldown — qualitative closing data', () => {
  it('prefers raw_closing_data over closing_analysis when both are present, matching SCORE_SQL\'s own preference order', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow({
        raw_closing_data: JSON.stringify({ general_strengths: 'From raw_closing_data' }),
        closing_analysis: JSON.stringify({ general_strengths: 'From closing_analysis' }),
      })])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    expect(result?.closingJson?.general_strengths).toBe('From raw_closing_data')
    const field = result?.fields.find(f => f.fieldKey === 'general_strengths')
    expect(field?.normalizedValue).toBe('From raw_closing_data')
  })

  it('surfaces general_strengths/general_improvement_areas as fields -- they already match lib/field-map.ts EXTRA_FIELD_MAP aliases with no extra mapping', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow({
        closing_analysis: JSON.stringify({
          overall_assessment: 'Needs improvement overall.',
          general_strengths: 'Good rapport.',
          general_improvement_areas: 'Product knowledge.',
        }),
      })])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    const byKey = Object.fromEntries((result?.fields ?? []).map(f => [f.fieldKey, f.normalizedValue]))
    expect(byKey['general_strengths']).toBe('Good rapport.')
    expect(byKey['general_improvement_areas']).toBe('Product knowledge.')
  })

  it('does not throw and returns null closingJson when closing_analysis is legacy raw HTML, not JSON', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow({ closing_analysis: '<div class="total-score">72 / 100</div>' })])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    expect(result).not.toBeNull()
    expect(result?.closingJson).toBeNull()
  })

  it('never re-adds a field key already produced by the transcript or score/result fields', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (String(body.sql).includes('r_user_session_details')) return respond([])
      return respond([sessionRow({ closing_analysis: JSON.stringify({ overall_score: '999' }) })])
    })

    const result = await mod.rolplayAppDrilldown(78, 29)
    const scoreFields = result?.fields.filter(f => f.fieldKey === 'overall_score') ?? []
    expect(scoreFields).toHaveLength(1)
    expect(scoreFields[0].normalizedValue).toBe(85) // the real extracted_score, not the closing_analysis's raw 999
  })
})

