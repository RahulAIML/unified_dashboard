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
vi.mock('@/lib/pharma-tenant', () => ({
  resolvePharmaTenantAccess: vi.fn(),
}))
vi.mock('@/lib/bridge-pharma-analytics', () => ({
  pharmaDashboardOverview: vi.fn(),
}))
vi.mock('@/lib/bridge-rolplay-app', async () => {
  // mergeOverviewSources is the real thing under test here -- only the
  // network-backed resolver/fetcher are stubbed, matching how the pharma
  // secondary-source composition actually runs in production.
  const actual = await vi.importActual<typeof import('@/lib/bridge-rolplay-app')>('@/lib/bridge-rolplay-app')
  return {
    ...actual,
    resolveRolplayAppAccess: vi.fn(),
    rolplayAppOverview: vi.fn(),
  }
})

import { GET } from '../overview/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { bancoOverviewFromSecondBrain } from '@/lib/banco-second-brain'
import { getDashboardOverview } from '@/lib/data-provider'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardOverview } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppOverview } from '@/lib/bridge-rolplay-app'

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

// ── 'pharma' org type (+ secondary rolplay_app_sql composition) ────────────────

describe("GET /api/dashboard/overview — orgType 'pharma'", () => {
  beforeEach(() => {
    vi.mocked(resolveOrgType).mockResolvedValue('pharma')
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue('m8')
    vi.mocked(pharmaDashboardOverview).mockResolvedValue({
      totalEvaluations: 100, avgScore: 80, passRate: 70,
      passedEvaluations: 70, prevTotalEvaluations: 90,
      prevAvgScore: 78, prevPassRate: 65,
    })
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(null)
  })

  it('returns 500 when the pharma tenant cannot be resolved', async () => {
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })

  it('returns the pharma data untouched when the user has no secondary rolplay_app_sql access', async () => {
    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalEvaluations).toBe(100)
    expect(body.meta.filters.source).toBe('pharma-m8')
    expect(rolplayAppOverview).not.toHaveBeenCalled()
  })

  it('composes (sums/weight-averages) a real secondary rolplay_app_sql source into the tenant-wide Overview', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)
    vi.mocked(rolplayAppOverview).mockResolvedValue({
      totalEvaluations: 50, avgScore: 90, passRate: 90,
      passedEvaluations: 45, prevTotalEvaluations: 10,
      prevAvgScore: 85, prevPassRate: 80,
    })

    const res  = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    // Counts sum across both real sources.
    expect(body.data.totalEvaluations).toBe(150)
    expect(body.data.passedEvaluations).toBe(115)
    // avgScore is a totalEvaluations-weighted blend, not a plain average:
    // (80*100 + 90*50) / 150 = 83.33... -> 83.3
    expect(body.data.avgScore).toBeCloseTo(83.3, 1)
    expect(body.meta.filters.source).toBe('pharma-m8+rolplay-app-24')
    expect(rolplayAppOverview).toHaveBeenCalledWith(24, {
      fromIso: '2026-04-06T00:00:00.000Z', toIso: '2026-05-06T00:00:00.000Z',
    })
  })

  it('does NOT attempt secondary-source composition for a module-scoped page (solution set)', async () => {
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(24)

    const res  = await GET(makeRequest('&solution=coach'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.totalEvaluations).toBe(100)
    expect(body.meta.filters.source).toBe('pharma-m8')
    // Module tabs keep their already-verified single-source scope: no
    // secondary lookup at all when a specific module is requested.
    expect(resolveRolplayAppAccess).not.toHaveBeenCalled()
    expect(rolplayAppOverview).not.toHaveBeenCalled()
  })
})
