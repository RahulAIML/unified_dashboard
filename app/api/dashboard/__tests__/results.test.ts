import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardResults: vi.fn() }))
vi.mock('@/lib/data-provider', () => ({ getEvaluationResults: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/pharma-tenant', () => ({ resolvePharmaTenantAccess: vi.fn() }))
vi.mock('@/lib/bridge-pharma-analytics', () => ({ pharmaDashboardResults: vi.fn() }))
vi.mock('@/lib/bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bridge-rolplay-app')>('@/lib/bridge-rolplay-app')
  return { ...actual, resolveRolplayAppAccess: vi.fn(), rolplayAppResults: vi.fn() }
})

import { GET } from '../results/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardResults } from '@/lib/bridge-banco-analytics'
import { getEvaluationResults } from '@/lib/data-provider'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardResults } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppResults } from '@/lib/bridge-rolplay-app'

const dateParams = 'from=2026-04-06T00:00:00.000Z&to=2026-05-06T00:00:00.000Z'
const makeReq    = (extra = '') =>
  new NextRequest(`http://localhost/api/dashboard/results?${dateParams}${extra}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue({ email: 'u@test.com', customerId: 5, userId: 1 })
  vi.mocked(bancoDashboardResults).mockResolvedValue({ data: [] })
  vi.mocked(getEvaluationResults).mockResolvedValue([])
})

describe('GET /api/dashboard/results', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthContextFromRequest).mockResolvedValue(null)
    expect((await GET(makeReq())).status).toBe(401)
  })

  it("returns empty data for orgType 'none'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('none')
    const body = await (await GET(makeReq())).json()
    expect(body.data).toEqual({ data: [] })
  })

  it("calls bancoDashboardResults for orgType 'banco'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('banco')
    vi.mocked(bancoDashboardResults).mockResolvedValue({
      data: [{ savedReportId: 1, usecaseId: 11, usecaseName: null, score: 75, result: 'passed', passed: true, date: '2026-04-15' }],
    })
    const body = await (await GET(makeReq())).json()
    expect(body.data.data[0].passed).toBe(true)
    expect(getEvaluationResults).not.toHaveBeenCalled()
  })

  it("calls getEvaluationResults for orgType 'analytics'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(getEvaluationResults).mockResolvedValue([])
    await GET(makeReq())
    expect(getEvaluationResults).toHaveBeenCalledOnce()
    expect(bancoDashboardResults).not.toHaveBeenCalled()
  })

  it('caps limit at 200', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(getEvaluationResults).mockResolvedValue([])
    await GET(makeReq('&limit=9999'))
    const call = vi.mocked(getEvaluationResults).mock.calls[0]
    expect(call[1]).toBe(200)
  })
})

describe("GET /api/dashboard/results — orgType 'pharma' (+ rolplay_app_sql composition)", () => {
  const pharmaRow = { savedReportId: 1, usecaseId: 11, usecaseName: 'Pharma UC', score: 60, result: 'fail', passed: false, date: '2026-04-20' }
  const rolplayRow = { savedReportId: 2, usecaseId: 3129, usecaseName: 'M8 Coach', score: 90, result: 'pass', passed: true, date: '2026-04-25' }

  beforeEach(() => {
    vi.mocked(resolveOrgType).mockResolvedValue('pharma')
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue('m8')
    vi.mocked(pharmaDashboardResults).mockResolvedValue({ data: [pharmaRow] })
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(null)
  })

  it('returns pharma rows untouched with no secondary source', async () => {
    const body = await (await GET(makeReq())).json()
    expect(body.data.data).toEqual([pharmaRow])
    expect(rolplayAppResults).not.toHaveBeenCalled()
  })

  it('composes rows from both sources, most-recent-first, capped at limit', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)
    vi.mocked(rolplayAppResults).mockResolvedValue({ data: [rolplayRow] })

    const body = await (await GET(makeReq('&limit=1'))).json()
    // rolplayRow (2026-04-25) is more recent than pharmaRow (2026-04-20) --
    // with limit=1 over the COMBINED set, only the real most-recent row wins.
    expect(body.data.data).toEqual([rolplayRow])
    expect(body.meta.filters.source).toBe('rolplay-app-24+pharma-m8')
  })

  it('does not attempt composition for a module-scoped request', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)
    await GET(makeReq('&solution=coach'))
    expect(resolveRolplayAppAccess).not.toHaveBeenCalled()
    expect(rolplayAppResults).not.toHaveBeenCalled()
  })
})
