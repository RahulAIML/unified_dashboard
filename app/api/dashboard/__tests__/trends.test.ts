import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardTrends: vi.fn() }))
vi.mock('@/lib/data-provider', () => ({ getDashboardTrends: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '../trends/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardTrends } from '@/lib/bridge-banco-analytics'
import { getDashboardTrends } from '@/lib/data-provider'

const EMPTY_TRENDS = { scoreTrend: [], passFailTrend: [], evalCountTrend: [] }
const dateParams   = 'from=2026-04-06T00:00:00.000Z&to=2026-05-06T00:00:00.000Z'
const makeReq      = (extra = '') =>
  new NextRequest(`http://localhost/api/dashboard/trends?${dateParams}${extra}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue({ email: 'u@test.com', customerId: 5, userId: 1 })
  vi.mocked(bancoDashboardTrends).mockResolvedValue({ scoreTrend: [], passFailTrend: [], evalCountTrend: [] })
  vi.mocked(getDashboardTrends).mockResolvedValue({ scoreTrend: [], passFailTrend: [], evalCountTrend: [] })
})

describe('GET /api/dashboard/trends', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthContextFromRequest).mockResolvedValue(null)
    expect((await GET(makeReq())).status).toBe(401)
  })

  it("returns empty trends for orgType 'none'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('none')
    const body = await (await GET(makeReq())).json()
    expect(body.data).toEqual(EMPTY_TRENDS)
    expect(bancoDashboardTrends).not.toHaveBeenCalled()
  })

  it("calls bancoDashboardTrends for orgType 'banco'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('banco')
    vi.mocked(bancoDashboardTrends).mockResolvedValue({
      scoreTrend: [{ date: '2026-04-10', value: 70 }],
      passFailTrend: [], evalCountTrend: [],
    })
    const body = await (await GET(makeReq())).json()
    expect(body.data.scoreTrend).toHaveLength(1)
    expect(getDashboardTrends).not.toHaveBeenCalled()
  })

  it("calls getDashboardTrends for orgType 'analytics'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(getDashboardTrends).mockResolvedValue(EMPTY_TRENDS)
    await GET(makeReq())
    expect(getDashboardTrends).toHaveBeenCalledOnce()
    expect(bancoDashboardTrends).not.toHaveBeenCalled()
  })

  it('returns empty for solution=second-brain', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    const body = await (await GET(makeReq('&solution=second-brain'))).json()
    expect(body.data).toEqual(EMPTY_TRENDS)
  })
})
