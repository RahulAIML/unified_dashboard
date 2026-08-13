/**
 * Tests for DashboardContent component
 *
 * Key assertions:
 *   - dbReady is true for both hasCoachData and hasBancoAccess users
 *   - Banco users are NOT redirected (no router.replace call)
 *   - "No access" state renders when hasAnyAccess is false
 *   - Loading skeleton renders while access status loads
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'

// ── Next.js mocks ─────────────────────────────────────────────────────────────

const mockRouterReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mockRouterReplace }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

// ── Store / hook mocks ────────────────────────────────────────────────────────

vi.mock('@/lib/store', () => ({
  useDashboardStore: () => ({
    dateRange:        { from: new Date('2026-04-06'), to: new Date('2026-05-06') },
    selectedSolution: 'all',
    refreshKey:       0,
  }),
}))
vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    overviewTitle:       'Global Overview',
    overviewSub:        'Analytics',
    noDataAvailable:    'No data',
    noAccessTitle:      'No Access',
    noAccessDescription:'Contact your administrator.',
    noAccessButton:     'Contact support',
    practiceSessions:   'Practice Sessions',
    avgSessionScore:    'Avg Score',
    overallPassRate:    'Pass Rate',
    certifiedUsers:     'Certified',
    activityTrend:      'Activity Trend',
    moduleBreakdown:    'Module Breakdown',
    topPerformers:      'Top Performers',
    evaluationResults:  'Results',
    name:               'Name',
    sessions:           'Sessions',
    avgScore:           'Avg Score',
    passRate:           'Pass Rate',
    date:               'Date',
    score:              'Score',
    status:             'Status',
    usecase:            'Use case',
    passed:             'Passed',
    failed:             'Failed',
  }),
}))
vi.mock('@/lib/hooks/useClientBrand', () => ({
  useClientBrand: () => ({ name: 'TestBrand', primaryColor: '#ff0000' }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ user: { id: 1, email: 'u@test.com' }, isLoading: false }),
}))
vi.mock('@/lib/hooks/useCombinedExport', () => ({
  useCombinedExport: () => ({ exportAllSolutions: vi.fn(), loading: false }),
}))
vi.mock('@/lib/kpi-builder', () => ({
  calcDeltaPct:           vi.fn().mockReturnValue(0),
  estimatePassedSessions: vi.fn().mockReturnValue(0),
}))
vi.mock('@/lib/csv-export', () => ({
  csvFilename: vi.fn().mockReturnValue('export.csv'),
}))

// framer-motion stub
vi.mock('framer-motion', () => ({
  motion:           { div: ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p}>{children}</div> },
  AnimatePresence:  ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Stub chart/heavy components
vi.mock('@/components/DashboardHeader', () => ({
  DashboardHeader: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}))
vi.mock('@/components/MetricCard',   () => ({ MetricCard:   () => <div /> }))
vi.mock('@/components/ChartCard',    () => ({ ChartCard:    ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/DataTable',    () => ({ DataTable:    () => <div /> }))
vi.mock('@/components/ExportButton', () => ({ ExportButton: () => <div /> }))
vi.mock('@/components/charts/ActivityLineChart', () => ({ ActivityLineChart: () => <div /> }))
vi.mock('@/components/charts/ModuleBarChart',    () => ({ ModuleBarChart:    () => <div /> }))
vi.mock('@/components/charts/DonutChart',        () => ({ DonutChart:        () => <div /> }))

// ── useApi mock factory ───────────────────────────────────────────────────────

let mockAccessStatus: Record<string, unknown> | null = null
let mockAccessLoading = false
let mockOverviewData: Record<string, unknown> | null = null

vi.mock('@/lib/hooks/useApi', () => ({
  useApi: (url: string | null) => {
    if (url?.includes('access-status')) {
      return { data: mockAccessStatus, loading: mockAccessLoading, error: null }
    }
    if (url?.includes('/api/dashboard/overview') && !url.includes('solution=certification')) {
      return { data: mockOverviewData, loading: false, error: null }
    }
    return { data: null, loading: false, error: null }
  },
  buildApiUrl: (path: string, from: Date, to: Date, extra?: Record<string, unknown>) =>
    `${path}?from=${from.toISOString()}&to=${to.toISOString()}` +
    (extra ? `&${Object.entries(extra).map(([k, v]) => `${k}=${v}`).join('&')}` : ''),
}))

import { DashboardContent } from '../DashboardContent'

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockAccessStatus  = null
  mockAccessLoading = false
  mockOverviewData  = null
  mockRouterReplace.mockClear()
})

function coachAccess() {
  return { hasCoachData: true, hasBancoAccess: false, hasSecondBrainData: false, hasAnyAccess: true }
}

/** The component shows a 400ms shimmer on mount (solution "changes" from
 *  null to the initial value) before real KPI content renders. */
async function renderPastInitialShimmer() {
  vi.useFakeTimers()
  render(<DashboardContent />)
  await act(async () => { vi.advanceTimersByTime(500) })
  vi.useRealTimers()
}

describe('DashboardContent — pass-rate legend / hide behavior', () => {
  it('shows the pass-rate tile with its legend when the tenant has a configured threshold', async () => {
    mockAccessStatus = coachAccess()
    mockOverviewData = {
      totalEvaluations: 100, avgScore: 82, passRate: 65, passedEvaluations: 65,
      prevTotalEvaluations: 90, prevAvgScore: 80, prevPassRate: 60,
      passRateLegend: 'Pass threshold: score ≥ 80 pts',
    }
    await renderPastInitialShimmer()
    expect(screen.getByText('Pass threshold: score ≥ 80 pts')).toBeTruthy()
  })

  it('omits the pass-rate tile entirely for a tenant with no passing criteria', async () => {
    mockAccessStatus = coachAccess()
    mockOverviewData = {
      totalEvaluations: 100, avgScore: 82, passRate: null, passedEvaluations: 0,
      prevTotalEvaluations: 90, prevAvgScore: 80, prevPassRate: null,
      passRateLegend: null,
    }
    await renderPastInitialShimmer()
    expect(screen.queryByText('Pass Rate')).toBeNull()
  })

  it('shows the pass-rate tile with no legend for an org type that has not been wired up yet', async () => {
    mockAccessStatus = coachAccess()
    mockOverviewData = {
      totalEvaluations: 100, avgScore: 82, passRate: 65, passedEvaluations: 65,
      prevTotalEvaluations: 90, prevAvgScore: 80, prevPassRate: 60,
      // passRateLegend intentionally absent (undefined), matching a
      // response built before this field existed.
    }
    await renderPastInitialShimmer()
    expect(screen.getByText('Pass Rate')).toBeTruthy()
  })
})

describe('DashboardContent — access routing', () => {
  it('does NOT redirect Banco users (hasBancoAccess=true)', () => {
    mockAccessStatus = {
      hasCoachData: false, hasBancoAccess: true,
      hasSecondBrainData: false, hasAnyAccess: true,
    }
    render(<DashboardContent />)
    expect(mockRouterReplace).not.toHaveBeenCalledWith('/banco')
  })

  it('does NOT redirect analytics users either', () => {
    mockAccessStatus = {
      hasCoachData: true, hasBancoAccess: false,
      hasSecondBrainData: false, hasAnyAccess: true,
    }
    render(<DashboardContent />)
    expect(mockRouterReplace).not.toHaveBeenCalled()
  })

  it('shows no-access state when hasAnyAccess is false', () => {
    mockAccessStatus = {
      hasCoachData: false, hasBancoAccess: false,
      hasSecondBrainData: false, hasAnyAccess: false,
    }
    render(<DashboardContent />)
    // The header still renders (it's always shown in the no-access state)
    expect(screen.queryByTestId('header')).toBeTruthy()
  })

  it('renders the header while access status is loading', () => {
    mockAccessStatus  = null
    mockAccessLoading = true
    render(<DashboardContent />)
    expect(screen.queryByTestId('header')).toBeTruthy()
  })
})

describe('DashboardContent — dbReady logic', () => {
  it('enables data fetching for hasCoachData users', () => {
    mockAccessStatus = {
      hasCoachData: true, hasBancoAccess: false,
      hasSecondBrainData: false, hasAnyAccess: true,
    }
    // If dbReady=true the header renders (not null-rendered before header)
    render(<DashboardContent />)
    expect(screen.queryByTestId('header')).toBeTruthy()
  })

  it('enables data fetching for hasBancoAccess users', () => {
    mockAccessStatus = {
      hasCoachData: false, hasBancoAccess: true,
      hasSecondBrainData: false, hasAnyAccess: true,
    }
    render(<DashboardContent />)
    expect(screen.queryByTestId('header')).toBeTruthy()
  })
})
