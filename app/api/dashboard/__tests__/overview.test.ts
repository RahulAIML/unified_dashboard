/**
 * Tests for GET /api/dashboard/overview
 *
 * Verifies the three org-type branches:
 *   'none'      → empty success response
 *   'banco'     → calls bancoOverviewFromSecondBrain
 *   'analytics' → calls getDashboardOverview (existing pipeline)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/server-auth', () => ({
  getAuthContextFromRequest: vi.fn(),
}))
vi.mock('@/lib/org-type', () => ({
  resolveOrgType: vi.fn(),
}))
vi.mock('@/lib/banco-second-brain', () => ({
  bancoOverviewFromSecondBrain: vi.fn(),
}))
vi.mock('@/lib/data-provider', () => ({
  getDashboardOverview: vi.fn(),
}))
vi.mock('@/lib/dynamic-usecase-resolver', () => ({
  resolveDynamicUsecaseIds: vi.fn().mockResolvedValue(undefined),
}))

import { GET } from '../overview/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoOverviewFromSecondBrain } from '@/lib/banco-second-brain'
import { getDashboardOverview } from '@/lib/data-provider'

const mockAuth = { email: 'user@test.com', customerId: 5, userId: 1 }
const dateParams = 'from=2026-04-06T00:00:00.000Z&to=2026-05-06T00:00:00.000Z'

function makeRequest(extra = '') {
  return new NextRequest(`http://localhost/api/dashboard/overview?${dateParams}${extra}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue(mockAuth)
  vi.mocked(bancoOverviewFromSecondBrain).mockResolvedValue({
    totalEvaluations: 0, avgScore: null, passRate: null,
    passedEvaluations: 0, prevTotalEvaluations: 0,
    prevAvgScore: null, prevPassRate: null,
  })
  vi.mocked(getDashboardOverview).mockResolvedValue({
    totalEvaluations: 0, avgScore: null, passRate: null,
    passedEvaluations: 0, prevTotalEvaluations: 0,
    prevAvgScore: null, prevPassRate: null,
  })
})

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/overview — auth', () => {
  it('returns 401 when not authenticated', async () => {
    vi.mocked(getAuthContextFromRequest).mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })
})

// ── 'none' org type ───────────────────────────────────────────────────────────

describe("GET /api/dashboard/overview — orgType 'none'", () => {
  it('returns empty overview without calling any data source', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('none')

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.totalEvaluations).toBe(0)
    expect(body.data.avgScore).toBeNull()
    expect(bancoOverviewFromSecondBrain).not.toHaveBeenCalled()
    expect(getDashboardOverview).not.toHaveBeenCalled()
  })
})

// ── 'banco' org type ──────────────────────────────────────────────────────────

describe("GET /api/dashboard/overview — orgType 'banco'", () => {
  it('calls bancoOverviewFromSecondBrain and returns its data', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('banco')
    vi.mocked(bancoOverviewFromSecondBrain).mockResolvedValue({
      totalEvaluations: 50, avgScore: null, passRate: null,
      passedEvaluations: 0, prevTotalEvaluations: 0,
      prevAvgScore: null, prevPassRate: null,
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalEvaluations).toBe(50)
    expect(bancoOverviewFromSecondBrain).toHaveBeenCalledOnce()
    expect(getDashboardOverview).not.toHaveBeenCalled()
  })

  it('returns an empty overview (never 500) when Second Brain has no profile for this user', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('banco')
    vi.mocked(bancoOverviewFromSecondBrain).mockResolvedValue({
      totalEvaluations: 0, avgScore: null, passRate: null,
      passedEvaluations: 0, prevTotalEvaluations: 0,
      prevAvgScore: null, prevPassRate: null,
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.totalEvaluations).toBe(0)
  })
})

// ── 'analytics' org type ──────────────────────────────────────────────────────

describe("GET /api/dashboard/overview — orgType 'analytics'", () => {
  it('calls getDashboardOverview and returns its data', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(getDashboardOverview).mockResolvedValue({
      totalEvaluations: 120, avgScore: 81, passRate: 88,
      passedEvaluations: 106, prevTotalEvaluations: 100,
      prevAvgScore: 78, prevPassRate: 84,
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalEvaluations).toBe(120)
    expect(getDashboardOverview).toHaveBeenCalledOnce()
    expect(bancoOverviewFromSecondBrain).not.toHaveBeenCalled()
  })

  it('returns empty when solution=second-brain', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')

    const res  = await GET(makeRequest('&solution=second-brain'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalEvaluations).toBe(0)
    expect(getDashboardOverview).not.toHaveBeenCalled()
  })

  it('returns 400 when date range is missing', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')

    const res = await GET(new NextRequest('http://localhost/api/dashboard/overview'))
    expect(res.status).toBe(400)
  })
})
