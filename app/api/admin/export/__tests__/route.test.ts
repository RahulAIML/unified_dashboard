/**
 * GET /api/admin/export -- internal/admin CSV export. Never client-facing:
 * gated behind requireAdminFromRequest exactly like every other admin-only
 * route (app/api/ai/known-companies). These tests check the auth gate,
 * per-module dispatch, CSV/attachment headers, and that the response is a
 * real CSV of the underlying rows -- never a re-derived/random KPI value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const requireAdminFromRequest = vi.fn()
const rateLimit = vi.fn()
const rolplayAppRawInteractions = vi.fn()
const lmsRawProgressRows = vi.fn()

vi.mock('@/lib/server-auth', () => ({
  requireAdminFromRequest: (...args: unknown[]) => requireAdminFromRequest(...args),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => rateLimit(...args),
  rateLimitHeaders: () => ({}),
}))
vi.mock('@/lib/bridge-rolplay-app', () => ({
  rolplayAppRawInteractions: (...args: unknown[]) => rolplayAppRawInteractions(...args),
}))
vi.mock('@/lib/lms-learnworlds', () => ({
  lmsRawProgressRows: (...args: unknown[]) => lmsRawProgressRows(...args),
}))

import { GET } from '../route'

const ADMIN = { userId: 1, email: 'admin@rolplay.ai', customerId: 0, role: 'admin' as const }

function req(qs: string) {
  return new NextRequest(`http://localhost/api/admin/export?${qs}`)
}

beforeEach(() => {
  requireAdminFromRequest.mockReset().mockResolvedValue(ADMIN)
  rateLimit.mockReset().mockReturnValue({ ok: true, remaining: 59 })
  rolplayAppRawInteractions.mockReset()
  lmsRawProgressRows.mockReset()
})

describe('GET /api/admin/export — auth gate', () => {
  it('rejects a non-admin with 403, the same as every other admin-only route', async () => {
    requireAdminFromRequest.mockResolvedValue(null)
    const res = await GET(req('module=coach&clientId=24'))
    expect(res.status).toBe(403)
    expect(rolplayAppRawInteractions).not.toHaveBeenCalled()
  })

  it('rejects when the request is rate-limited', async () => {
    rateLimit.mockReturnValue({ ok: false, remaining: 0 })
    const res = await GET(req('module=coach&clientId=24'))
    expect(res.status).toBe(429)
  })
})

describe('GET /api/admin/export — validation', () => {
  it('400s when module is missing', async () => {
    const res = await GET(req(''))
    expect(res.status).toBe(400)
  })

  it('400s for an unknown module', async () => {
    const res = await GET(req('module=banana'))
    expect(res.status).toBe(400)
  })

  it('400s when clientId is missing for a rolplay_app_sql module', async () => {
    const res = await GET(req('module=coach'))
    expect(res.status).toBe(400)
  })

  it('400s when clientId is not a valid positive number', async () => {
    const res = await GET(req('module=coach&clientId=abc'))
    expect(res.status).toBe(400)
  })

  it('400s when tenant is missing for module=lms', async () => {
    const res = await GET(req('module=lms'))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/admin/export — coach/simulator/certification/other modules', () => {
  const REAL_ROW = {
    session_id: 1919, client_id: 24, user_id: 501, user_name: 'Raul Osuna',
    user_email: 'raul.osuna@arceralifesciences.com', user_department: 'Ventas', user_designation: 'Rep',
    simulator_id: 3129, simulator_name: 'Coach M8 Legalon y Abcito', module_category: 'COACH',
    date_created: '2026-08-20 15:50:04', score: 80, score_source: 'json:score_bar', result: 'pass' as const,
    legacy_score: null, legacy_passed_flag: null, rating_score: null, interaction_type: 2,
  }

  it('returns a real CSV attachment for module=coach with real row data (not a re-derived KPI)', async () => {
    rolplayAppRawInteractions.mockResolvedValue([REAL_ROW])
    const res = await GET(req('module=coach&clientId=24'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    expect(res.headers.get('Content-Disposition')).toContain('export-coach-24')

    const csv = await res.text()
    expect(csv).toContain('session_id')
    expect(csv).toContain('raul.osuna@arceralifesciences.com')
    expect(csv).toContain('80') // the real score, verbatim
    expect(csv).toContain('json:score_bar') // the real derived provenance field
  })

  it('maps module=simulator/certification/other to the correct SCORE_SQL category', async () => {
    rolplayAppRawInteractions.mockResolvedValue([])
    await GET(req('module=simulator&clientId=24'))
    expect(rolplayAppRawInteractions).toHaveBeenCalledWith(24, 'SIM', undefined, 5000)
    await GET(req('module=certification&clientId=24'))
    expect(rolplayAppRawInteractions).toHaveBeenCalledWith(24, 'SEGMENT', undefined, 5000)
    await GET(req('module=other&clientId=24'))
    expect(rolplayAppRawInteractions).toHaveBeenCalledWith(24, 'OTHER', undefined, 5000)
  })

  it('passes the date range through when both from and to are given', async () => {
    rolplayAppRawInteractions.mockResolvedValue([])
    await GET(req('module=coach&clientId=24&from=2026-06-01T00:00:00.000Z&to=2026-06-08T00:00:00.000Z'))
    expect(rolplayAppRawInteractions).toHaveBeenCalledWith(
      24, 'COACH', { fromIso: '2026-06-01T00:00:00.000Z', toIso: '2026-06-08T00:00:00.000Z' }, 5000,
    )
  })

  it('returns a real, readable "no data" CSV rather than an error for an empty result', async () => {
    rolplayAppRawInteractions.mockResolvedValue([])
    const res = await GET(req('module=coach&clientId=24'))
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv.toLowerCase()).toContain('no data available')
  })

  it('handles a larger result set (100 real rows) without truncating the CSV', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...REAL_ROW, session_id: i + 1 }))
    rolplayAppRawInteractions.mockResolvedValue(many)
    const res = await GET(req('module=coach&clientId=24'))
    const csv = await res.text()
    const dataLines = csv.trim().split('\n').length - 1 // minus header
    expect(dataLines).toBe(100)
  })

  it('honors a custom limit, clamped to the safe ceiling', async () => {
    rolplayAppRawInteractions.mockResolvedValue([])
    await GET(req('module=coach&clientId=24&limit=999999'))
    expect(rolplayAppRawInteractions).toHaveBeenCalledWith(24, 'COACH', undefined, 20000)
  })

  it('keeps two different clientIds fully isolated -- never mixes their rows', async () => {
    rolplayAppRawInteractions.mockResolvedValue([{ ...REAL_ROW, client_id: 24 }])
    const m8 = await (await GET(req('module=coach&clientId=24'))).text()
    expect(rolplayAppRawInteractions).toHaveBeenLastCalledWith(24, 'COACH', undefined, 5000)

    rolplayAppRawInteractions.mockResolvedValue([{ ...REAL_ROW, session_id: 2, client_id: 29, user_email: 'x@siigo.com' }])
    const siigo = await (await GET(req('module=simulator&clientId=29'))).text()
    expect(rolplayAppRawInteractions).toHaveBeenLastCalledWith(29, 'SIM', undefined, 5000)

    expect(m8).toContain('arceralifesciences.com')
    expect(m8).not.toContain('siigo.com')
    expect(siigo).toContain('siigo.com')
    expect(siigo).not.toContain('arceralifesciences.com')
  })

  it('never leaks the raw upstream error message on failure', async () => {
    rolplayAppRawInteractions.mockRejectedValue(new Error('SECRET-SQL-CONNECTION-STRING-LEAK'))
    const res = await GET(req('module=coach&clientId=24'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('SECRET-SQL-CONNECTION-STRING-LEAK')
  })
})

describe('GET /api/admin/export — lms module', () => {
  it('returns a real CSV for module=lms using the tenant key', async () => {
    lmsRawProgressRows.mockResolvedValue([{
      tenant: 'apotex', user_id: 'u1', user_email: 'rep@apotex.com.mx', user_name: 'Ana Lopez',
      course_id: 'c1', course_title: 'Intro', status: 'completed', progress_rate: 100,
      average_score_rate: 88, time_on_course: 4880, total_units: 1, completed_units: 1, completed_at: '2026-07-19',
    }])
    const res = await GET(req('module=lms&tenant=apotex'))
    expect(res.status).toBe(200)
    expect(lmsRawProgressRows).toHaveBeenCalledWith('apotex')
    const csv = await res.text()
    expect(csv).toContain('rep@apotex.com.mx')
    expect(csv).toContain('Intro')
  })

  it('returns an honest empty CSV for a tenant with no LMS configured, not an error', async () => {
    lmsRawProgressRows.mockResolvedValue([])
    const res = await GET(req('module=lms&tenant=sanfer'))
    expect(res.status).toBe(200)
    const csv = await res.text()
    expect(csv.toLowerCase()).toContain('no data available')
  })

  it('does not accept a date range for lms (current-state roster export)', async () => {
    lmsRawProgressRows.mockResolvedValue([])
    await GET(req('module=lms&tenant=apotex&from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z'))
    expect(lmsRawProgressRows).toHaveBeenCalledWith('apotex')
  })
})
