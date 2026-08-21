/**
 * lib/bridge-rolplay-app.ts's rolplayAppRawInteractions -- the admin/internal
 * raw per-session export. Every field must trace to a real, confirmed table
 * column; these tests check the SQL shape (module scoping, date scoping,
 * limit clamping) and safe handling of empty/malformed rows, mirroring the
 * live-verified schema this was built from.
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
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

let capturedSql = ''
function captureAndRespond(data: unknown[]) {
  fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
    capturedSql = JSON.parse(String(init.body)).sql
    return respond(data)
  })
}

beforeEach(() => {
  fetchSpy.mockReset()
  capturedSql = ''
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

const REAL_ROW = {
  session_id: 1919, client_id: 24, user_id: 501, user_name: 'Raul Osuna',
  user_email: 'raul.osuna@arceralifesciences.com', user_department: 'Ventas', user_designation: 'Rep',
  simulator_id: 3129, simulator_name: 'Coach M8 Legalon y Abcito', module_category: 'COACH',
  date_created: '2026-08-20 15:50:04', score: '80.00', score_source: 'json:score_bar',
  legacy_score: null, legacy_passed_flag: null, rating_score: null, interaction_type: 2,
}

describe('rolplayAppRawInteractions — module scoping', () => {
  it('scopes to the COACH category for module=COACH', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'COACH')
    expect(capturedSql).toContain("sim.category = 'COACH'")
  })

  it('scopes to SIM for module=SIM', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'SIM')
    expect(capturedSql).toContain("sim.category = 'SIM'")
  })

  it('scopes to SEGMENT for module=SEGMENT', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'SEGMENT')
    expect(capturedSql).toContain("sim.category = 'SEGMENT'")
  })

  it('OTHER excludes COACH/SIM/SEGMENT/SB, never dumps Second Brain sessions into it', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'OTHER')
    expect(capturedSql).toContain("sim.category NOT IN ('COACH','SIM','SEGMENT','SB')")
  })

  it('scopes every query to the given client_id, preserving tenant isolation', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(29, 'SIM')
    expect(capturedSql).toContain('u.client_id = 29')
  })

  it('rejects an invalid client id rather than sending it to the query', async () => {
    const mod = await fresh()
    await expect(mod.rolplayAppRawInteractions(-1, 'SIM')).rejects.toThrow()
    await expect(mod.rolplayAppRawInteractions(0, 'SIM')).rejects.toThrow()
  })
})

describe('rolplayAppRawInteractions — date range and limit', () => {
  it('applies a date clause when a range is given', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'SIM', { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-06-08T00:00:00.000Z' })
    expect(capturedSql).toContain("BETWEEN '2026-06-01 00:00:00'")
  })

  it('omits the date clause entirely when no range is given (full history)', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'SIM')
    expect(capturedSql).not.toContain('BETWEEN')
  })

  it('clamps an oversized limit to the hard ceiling', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'SIM', undefined, 999_999)
    expect(capturedSql).toContain('LIMIT 20000')
  })

  it('clamps a zero/negative limit up to at least 1', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'SIM', undefined, -5)
    expect(capturedSql).toContain('LIMIT 1')
  })

  it('defaults to 5000 when no limit is given', async () => {
    const mod = await fresh()
    captureAndRespond([])
    await mod.rolplayAppRawInteractions(24, 'SIM')
    expect(capturedSql).toContain('LIMIT 5000')
  })
})

describe('rolplayAppRawInteractions — empty, small, larger, and malformed data', () => {
  it('returns an empty array (never throws) for a tenant/module with zero sessions', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([]))
    const rows = await mod.rolplayAppRawInteractions(24, 'SEGMENT')
    expect(rows).toEqual([])
  })

  it('maps a single real row correctly, including the derived result/score_source fields', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([REAL_ROW]))
    const rows = await mod.rolplayAppRawInteractions(24, 'COACH')
    expect(rows).toEqual([{
      session_id: 1919, client_id: 24, user_id: 501, user_name: 'Raul Osuna',
      user_email: 'raul.osuna@arceralifesciences.com', user_department: 'Ventas', user_designation: 'Rep',
      simulator_id: 3129, simulator_name: 'Coach M8 Legalon y Abcito', module_category: 'COACH',
      date_created: '2026-08-20 15:50:04', score: 80, score_source: 'json:score_bar', result: 'pass',
      legacy_score: null, legacy_passed_flag: null, rating_score: null, interaction_type: 2,
    }])
  })

  it('handles a larger real result set (100 rows) without dropping or reordering any', async () => {
    const mod = await fresh()
    const many = Array.from({ length: 100 }, (_, i) => ({ ...REAL_ROW, session_id: i + 1 }))
    fetchSpy.mockResolvedValue(respond(many))
    const rows = await mod.rolplayAppRawInteractions(24, 'COACH')
    expect(rows).toHaveLength(100)
    expect(rows.map(r => r.session_id)).toEqual(many.map(r => r.session_id))
  })

  it('never fabricates a score_source for a row with no extractable score (malformed/unscoreable session)', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([{ ...REAL_ROW, score: null, score_source: 'json:score_bar' }]))
    // A real (buggy) upstream row could carry a stale score_source label even
    // when SCORE_SQL itself found nothing -- this must never surface as a
    // fabricated non-null score_source next to a null score.
    const rows = await mod.rolplayAppRawInteractions(24, 'COACH')
    expect(rows[0].score).toBeNull()
    expect(rows[0].score_source).toBeNull()
    expect(rows[0].result).toBeNull()
  })

  it('handles missing/null simulator join fields safely (a session whose simulator was deleted)', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([{
      ...REAL_ROW, simulator_id: null, simulator_name: null, module_category: null,
    }]))
    const rows = await mod.rolplayAppRawInteractions(24, 'COACH')
    expect(rows[0].simulator_id).toBeNull()
    expect(rows[0].simulator_name).toBeNull()
    expect(rows[0].module_category).toBeNull()
  })

  it('computes result=fail (not null) for a real sub-threshold score', async () => {
    const mod = await fresh()
    fetchSpy.mockResolvedValue(respond([{ ...REAL_ROW, score: '53.00' }]))
    const rows = await mod.rolplayAppRawInteractions(24, 'SIM')
    expect(rows[0].score).toBe(53)
    expect(rows[0].result).toBe('fail')
  })
})

describe('rolplayAppRawInteractions — multiple clients stay isolated', () => {
  it('two different client ids never share rows or cross-contaminate the WHERE clause', async () => {
    const mod = await fresh()
    captureAndRespond([{ ...REAL_ROW, client_id: 24 }])
    const m8 = await mod.rolplayAppRawInteractions(24, 'COACH')
    expect(capturedSql).toContain('u.client_id = 24')
    expect(m8.every(r => r.client_id === 24)).toBe(true)

    captureAndRespond([{ ...REAL_ROW, session_id: 2, client_id: 29, user_email: 'x@siigo.com' }])
    const siigo = await mod.rolplayAppRawInteractions(29, 'SIM')
    expect(capturedSql).toContain('u.client_id = 29')
    expect(capturedSql).not.toContain('u.client_id = 24')
    expect(siigo.every(r => r.client_id === 29)).toBe(true)
  })
})
