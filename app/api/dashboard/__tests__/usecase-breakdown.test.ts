import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardUsecaseBreakdown: vi.fn() }))
vi.mock('@/lib/data-provider', () => ({ getUsecaseBreakdown: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '../usecase-breakdown/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardUsecaseBreakdown } from '@/lib/bridge-banco-analytics'
import { getUsecaseBreakdown } from '@/lib/data-provider'

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
    vi.mocked(resolveOrgType).mockReturnValue('none')
    const body = await (await GET(makeReq())).json()
    expect(body.data).toEqual({ data: [] })
  })

  it("calls bancoDashboardUsecaseBreakdown for orgType 'banco'", async () => {
    vi.mocked(resolveOrgType).mockReturnValue('banco')
    vi.mocked(bancoDashboardUsecaseBreakdown).mockResolvedValue({
      data: [{ usecaseId: 11, usecase_name: null, totalEvaluations: 10, avgScore: 70, passRate: 80, passed: 8 }],
    })
    const body = await (await GET(makeReq())).json()
    expect(body.data.data).toHaveLength(1)
    expect(getUsecaseBreakdown).not.toHaveBeenCalled()
  })

  it("calls getUsecaseBreakdown for orgType 'analytics'", async () => {
    vi.mocked(resolveOrgType).mockReturnValue('analytics')
    vi.mocked(getUsecaseBreakdown).mockResolvedValue([])
    await GET(makeReq())
    expect(getUsecaseBreakdown).toHaveBeenCalledOnce()
    expect(bancoDashboardUsecaseBreakdown).not.toHaveBeenCalled()
  })
})
