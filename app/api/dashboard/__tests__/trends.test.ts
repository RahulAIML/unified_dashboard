import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardTrends: vi.fn() }))
vi.mock('@/lib/data-provider', () => ({ getDashboardTrends: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/pharma-tenant', () => ({ resolvePharmaTenantAccess: vi.fn() }))
vi.mock('@/lib/bridge-pharma-analytics', () => ({ pharmaDashboardTrends: vi.fn() }))
vi.mock('@/lib/bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bridge-rolplay-app')>('@/lib/bridge-rolplay-app')
  return { ...actual, resolveRolplayAppAccess: vi.fn(), rolplayAppTrends: vi.fn() }
})

import { GET } from '../trends/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardTrends } from '@/lib/bridge-banco-analytics'
import { getDashboardTrends } from '@/lib/data-provider'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardTrends } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppTrends } from '@/lib/bridge-rolplay-app'

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

describe("GET /api/dashboard/trends — orgType 'pharma' (+ rolplay_app_sql composition)", () => {
  beforeEach(() => {
    vi.mocked(resolveOrgType).mockResolvedValue('pharma')
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue('m8')
    vi.mocked(pharmaDashboardTrends).mockResolvedValue({
      scoreTrend: [{ date: '2026-04-10', value: 70 }],
      passFailTrend: [{ date: '2026-04-10', value: 6, value2: 4 }],
      evalCountTrend: [{ date: '2026-04-10', value: 10 }],
    })
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(null)
  })

  it('returns pharma trends untouched with no secondary source', async () => {
    const body = await (await GET(makeReq())).json()
    expect(body.data.evalCountTrend).toEqual([{ date: '2026-04-10', value: 10 }])
  })

  it('sums counts and weight-averages the score for a date present in both sources', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)
    vi.mocked(rolplayAppTrends).mockResolvedValue({
      scoreTrend: [{ date: '2026-04-10', value: 90 }],
      passFailTrend: [{ date: '2026-04-10', value: 5 }],
      evalCountTrend: [{ date: '2026-04-10', value: 5 }],
    })

    const body = await (await GET(makeReq())).json()
    expect(body.data.evalCountTrend).toEqual([{ date: '2026-04-10', value: 15 }]) // 10 + 5
    expect(body.data.passFailTrend).toEqual([{ date: '2026-04-10', value: 11, value2: 4 }]) // passed 6+5, failed derived 15-11
    // weighted score: (70*10 + 90*5) / 15 = 76.666... -> 76.67
    expect(body.data.scoreTrend[0].value).toBeCloseTo(76.67, 1)
    expect(body.meta.filters.source).toBe('rolplay-app-24+pharma-m8')
  })

  it('passes a date present in only ONE source through unchanged, never averaging against an absent value', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)
    vi.mocked(rolplayAppTrends).mockResolvedValue({
      scoreTrend: [{ date: '2026-04-11', value: 90 }],
      passFailTrend: [{ date: '2026-04-11', value: 3 }],
      evalCountTrend: [{ date: '2026-04-11', value: 3 }],
    })

    const body = await (await GET(makeReq())).json()
    const byDate = Object.fromEntries(body.data.scoreTrend.map((p: { date: string; value: number }) => [p.date, p.value]))
    expect(byDate['2026-04-10']).toBe(70) // pharma's only, unchanged
    expect(byDate['2026-04-11']).toBe(90) // rolplay-app's only, unchanged
  })
})
