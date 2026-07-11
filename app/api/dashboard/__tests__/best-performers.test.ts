import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardBestPerformers: vi.fn() }))
vi.mock('@/lib/bridge-client', () => ({ bridgeBestPerformers: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '../best-performers/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardBestPerformers } from '@/lib/bridge-banco-analytics'
import { bridgeBestPerformers } from '@/lib/bridge-client'

const dateParams = 'from=2026-04-06T00:00:00.000Z&to=2026-05-06T00:00:00.000Z'
const makeReq    = (extra = '') =>
  new NextRequest(`http://localhost/api/dashboard/best-performers?${dateParams}${extra}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue({ email: 'u@test.com', customerId: 5, userId: 1 })
  vi.mocked(bancoDashboardBestPerformers).mockResolvedValue({ data: [] })
  vi.mocked(bridgeBestPerformers).mockResolvedValue([])
})

describe('GET /api/dashboard/best-performers', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthContextFromRequest).mockResolvedValue(null)
    expect((await GET(makeReq())).status).toBe(401)
  })

  it("returns empty data for orgType 'none'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('none')
    const body = await (await GET(makeReq())).json()
    expect(body.data).toEqual({ data: [] })
  })

  it("calls bancoDashboardBestPerformers for orgType 'banco'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('banco')
    vi.mocked(bancoDashboardBestPerformers).mockResolvedValue({
      data: [{ user_email: '', user_name: 'Juan', sessions: 5, avg_score: 75, pass_rate: 80 }],
    })
    const body = await (await GET(makeReq())).json()
    expect(body.data.data[0].user_name).toBe('Juan')
    expect(body.data.data[0].user_email).toBe('')
    expect(bridgeBestPerformers).not.toHaveBeenCalled()
  })

  it("calls bridgeBestPerformers for orgType 'analytics'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(bridgeBestPerformers).mockResolvedValue([])
    await GET(makeReq())
    expect(bridgeBestPerformers).toHaveBeenCalledOnce()
    expect(bancoDashboardBestPerformers).not.toHaveBeenCalled()
  })

  it('caps limit at 5 for analytics', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(bridgeBestPerformers).mockResolvedValue([])
    await GET(makeReq('&limit=100'))
    const call = vi.mocked(bridgeBestPerformers).mock.calls[0][0]
    expect(call.limit).toBe(5)
  })
})
