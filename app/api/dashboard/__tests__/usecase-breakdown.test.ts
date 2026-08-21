import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardUsecaseBreakdown: vi.fn() }))
vi.mock('@/lib/data-provider', () => ({ getUsecaseBreakdown: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/pharma-tenant', () => ({ resolvePharmaTenantAccess: vi.fn() }))
vi.mock('@/lib/bridge-pharma-analytics', () => ({ pharmaDashboardUsecaseBreakdown: vi.fn() }))
vi.mock('@/lib/bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bridge-rolplay-app')>('@/lib/bridge-rolplay-app')
  return { ...actual, resolveRolplayAppAccess: vi.fn(), rolplayAppUsecaseBreakdown: vi.fn() }
})

import { GET } from '../usecase-breakdown/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardUsecaseBreakdown } from '@/lib/bridge-banco-analytics'
import { getUsecaseBreakdown } from '@/lib/data-provider'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardUsecaseBreakdown } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppUsecaseBreakdown } from '@/lib/bridge-rolplay-app'

const dateParams = 'from=2026-04-06T00:00:00.000Z&to=2026-05-06T00:00:00.000Z'
const makeReq    = (extra = '') =>
  new NextRequest(`http://localhost/api/dashboard/usecase-breakdown?${dateParams}${extra}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue({ email: 'u@test.com', customerId: 5, userId: 1 })
  vi.mocked(bancoDashboardUsecaseBreakdown).mockResolvedValue({ data: [] })
  vi.mocked(getUsecaseBreakdown).mockResolvedValue([])
})

describe('GET /api/dashboard/usecase-breakdown', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthContextFromRequest).mockResolvedValue(null)
    expect((await GET(makeReq())).status).toBe(401)
  })

  it("returns empty data for orgType 'none'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('none')
    const body = await (await GET(makeReq())).json()
    expect(body.data).toEqual({ data: [] })
  })

  it("calls bancoDashboardUsecaseBreakdown for orgType 'banco'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('banco')
    vi.mocked(bancoDashboardUsecaseBreakdown).mockResolvedValue({
      data: [{ usecaseId: 11, usecase_name: null, totalEvaluations: 10, avgScore: 70, passRate: 80, passed: 8 }],
    })
    const body = await (await GET(makeReq())).json()
    expect(body.data.data).toHaveLength(1)
    expect(getUsecaseBreakdown).not.toHaveBeenCalled()
  })

  it("calls getUsecaseBreakdown for orgType 'analytics'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(getUsecaseBreakdown).mockResolvedValue([])
    await GET(makeReq())
    expect(getUsecaseBreakdown).toHaveBeenCalledOnce()
    expect(bancoDashboardUsecaseBreakdown).not.toHaveBeenCalled()
  })
})

describe("GET /api/dashboard/usecase-breakdown — orgType 'pharma' (+ rolplay_app_sql composition)", () => {
  const pharmaUc = { usecaseId: 137, usecase_name: 'Pharma UC', totalEvaluations: 20, avgScore: 70, passRate: 80, passed: 16 }
  const rolplayUc = { usecaseId: 3129, usecase_name: 'M8 Coach', totalEvaluations: 318, avgScore: 50, passRate: 40, passed: 127 }

  beforeEach(() => {
    vi.mocked(resolveOrgType).mockResolvedValue('pharma')
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue('m8')
    vi.mocked(pharmaDashboardUsecaseBreakdown).mockResolvedValue({ data: [pharmaUc] })
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(null)
  })

  it('returns pharma rows untouched with no secondary source', async () => {
    const body = await (await GET(makeReq())).json()
    expect(body.data.data).toEqual([pharmaUc])
  })

  it('concatenates both sources and sorts by totalEvaluations descending', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)
    vi.mocked(rolplayAppUsecaseBreakdown).mockResolvedValue({ data: [rolplayUc] })

    const body = await (await GET(makeReq())).json()
    expect(body.data.data).toEqual([rolplayUc, pharmaUc]) // 318 > 20
    expect(body.meta.filters.source).toBe('rolplay-app-24+pharma-m8')
  })
})
