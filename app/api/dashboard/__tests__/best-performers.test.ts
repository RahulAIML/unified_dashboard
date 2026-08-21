import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/bridge-banco-analytics', () => ({ bancoDashboardBestPerformers: vi.fn() }))
vi.mock('@/lib/bridge-client', () => ({ bridgeBestPerformers: vi.fn() }))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/pharma-tenant', () => ({ resolvePharmaTenantAccess: vi.fn() }))
vi.mock('@/lib/bridge-pharma-analytics', () => ({ pharmaDashboardBestPerformers: vi.fn() }))
vi.mock('@/lib/bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bridge-rolplay-app')>('@/lib/bridge-rolplay-app')
  return { ...actual, resolveRolplayAppAccess: vi.fn(), rolplayAppBestPerformers: vi.fn() }
})

import { GET } from '../best-performers/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoDashboardBestPerformers } from '@/lib/bridge-banco-analytics'
import { bridgeBestPerformers } from '@/lib/bridge-client'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardBestPerformers } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppBestPerformers } from '@/lib/bridge-rolplay-app'

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

  it('caps limit at 20 for analytics', async () => {
    // Raised from 5 -> 20: Overview's own card already requested limit=10
    // and was being silently truncated to 5; the new dedicated /ranking
    // page needs more than 5 too.
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(bridgeBestPerformers).mockResolvedValue([])
    await GET(makeReq('&limit=100'))
    const call = vi.mocked(bridgeBestPerformers).mock.calls[0][0]
    expect(call.limit).toBe(20)
  })

  it('still honors a real limit under the cap', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(bridgeBestPerformers).mockResolvedValue([])
    await GET(makeReq('&limit=10'))
    const call = vi.mocked(bridgeBestPerformers).mock.calls[0][0]
    expect(call.limit).toBe(10)
  })
})

describe("GET /api/dashboard/best-performers — orgType 'pharma' (+ rolplay_app_sql composition)", () => {
  const pharmaOnly = { user_email: 'jane@m8.com', user_name: 'Jane', sessions: 4, avg_score: 60, pass_rate: 50 }
  // Same real rep, active in BOTH systems -- the exact case this merge exists for.
  const sameRepPharma  = { user_email: 'Raul.Osuna@ArceraLifeSciences.com', user_name: null, sessions: 2, avg_score: 80, pass_rate: 100 }
  const sameRepRolplay = { user_email: 'raul.osuna@arceralifesciences.com', user_name: 'Raul Osuna', sessions: 8, avg_score: 50, pass_rate: 25 }

  beforeEach(() => {
    vi.mocked(resolveOrgType).mockResolvedValue('pharma')
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue('m8')
    vi.mocked(pharmaDashboardBestPerformers).mockResolvedValue({ data: [pharmaOnly] })
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(null)
  })

  it('returns pharma rows untouched with no secondary source', async () => {
    const body = await (await GET(makeReq())).json()
    expect(body.data.data).toEqual([pharmaOnly])
  })

  it('merges the SAME rep (case-insensitive email) across sources instead of listing them twice', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)
    vi.mocked(pharmaDashboardBestPerformers).mockResolvedValue({ data: [pharmaOnly, sameRepPharma] })
    vi.mocked(rolplayAppBestPerformers).mockResolvedValue({ data: [sameRepRolplay] })

    const body = await (await GET(makeReq())).json()
    const rows = body.data.data as { user_email: string; sessions: number; avg_score: number; pass_rate: number; user_name: string | null }[]

    expect(rows).toHaveLength(2) // jane + the merged raul row, never 3
    const raul = rows.find(r => r.user_email.toLowerCase() === 'raul.osuna@arceralifesciences.com')!
    expect(raul.sessions).toBe(10) // 2 + 8
    // weighted avg_score: (80*2 + 50*8) / 10 = 56
    expect(raul.avg_score).toBeCloseTo(56, 5)
    expect(raul.user_name).toBe('Raul Osuna') // pharma's was null, rolplay's real name used instead
  })
})
