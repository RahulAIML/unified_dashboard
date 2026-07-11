import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardResults: vi.fn() }))
vi.mock('@/lib/data-provider', () => ({ getEvaluationResults: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '../results/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardResults } from '@/lib/bridge-banco-analytics'
import { getEvaluationResults } from '@/lib/data-provider'

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
      data: [{ savedReportId: 1, usecaseId: 11, score: 75, result: 'passed', passed: true, date: '2026-04-15' }],
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
