/**
 * Tests for GET /api/dashboard/overview
 *
 * Verifies the three org-type branches:
 *   'none'      → empty success response
 *   'banco'     → calls bancoDashboardOverview
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
vi.mock('@/lib/bridge-banco-analytics', () => ({
  bancoDashboardOverview: vi.fn(),
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
import { bancoDashboardOverview } from '@/lib/bridge-banco-analytics'
import { getDashboardOverview } from '@/lib/data-provider'

const mockAuth = { email: 'user@test.com', customerId: 5, userId: 1 }
const dateParams = 'from=2026-04-06T00:00:00.000Z&to=2026-05-06T00:00:00.000Z'

function makeRequest(extra = '') {
  return new NextRequest(`http://localhost/api/dashboard/overview?${dateParams}${extra}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue(mockAuth)
  vi.mocked(bancoDashboardOverview).mockResolvedValue({
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
    vi.mocked(resolveOrgType).mockReturnValue('none')

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.totalEvaluations).toBe(0)
    expect(body.data.avgScore).toBeNull()
    expect(bancoDashboardOverview).not.toHaveBeenCalled()
    expect(getDashboardOverview).not.toHaveBeenCalled()
  })
})

// ── 'banco' org type ──────────────────────────────────────────────────────────

describe("GET /api/dashboard/overview — orgType 'banco'", () => {
  it('calls bancoDashboardOverview and returns its data', async () => {
    vi.mocked(resolveOrgType).mockReturnValue('banco')
    vi.mocked(bancoDashboardOverview).mockResolvedValue({
      totalEvaluations: 50, avgScore: 72.5, passRate: 80,
      passedEvaluations: 40, prevTotalEvaluations: 30,
      prevAvgScore: 68, prevPassRate: 75,
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalEvaluations).toBe(50)
    expect(body.data.avgScore).toBe(72.5)
    expect(bancoDashboardOverview).toHaveBeenCalledOnce()
    expect(getDashboardOverview).not.toHaveBeenCalled()
  })

  it('returns 500 when banco bridge throws', async () => {
    vi.mocked(resolveOrgType).mockReturnValue('banco')
    vi.mocked(bancoDashboardOverview).mockRejectedValue(new Error('bridge down'))

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.success).toBe(false)
  })
})

// ── 'analytics' org type ──────────────────────────────────────────────────────

describe("GET /api/dashboard/overview — orgType 'analytics'", () => {
  it('calls getDashboardOverview and returns its data', async () => {
    vi.mocked(resolveOrgType).mockReturnValue('analytics')
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
    expect(bancoDashboardOverview).not.toHaveBeenCalled()
  })

  it('returns empty when solution=second-brain', async () => {
    vi.mocked(resolveOrgType).mockReturnValue('analytics')

    const res  = await GET(makeRequest('&solution=second-brain'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalEvaluations).toBe(0)
    expect(getDashboardOverview).not.toHaveBeenCalled()
  })

  it('returns 400 when date range is missing', async () => {
    vi.mocked(resolveOrgType).mockReturnValue('analytics')

    const res = await GET(new NextRequest('http://localhost/api/dashboard/overview'))
    expect(res.status).toBe(400)
  })
})
