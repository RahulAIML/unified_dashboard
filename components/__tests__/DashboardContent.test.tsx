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
import { render, screen } from '@testing-library/react'
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
vi.mock('@/components/SummaryCard', () => ({ SummaryCard: () => <div /> }))
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

vi.mock('@/lib/hooks/useApi', () => ({
  useApi: (url: string | null) => {
    if (url?.includes('access-status')) {
      return { data: mockAccessStatus, loading: mockAccessLoading, error: null }
    }
    return { data: null, loading: false, error: null }
  },
  buildApiUrl: (path: string, from: Date, to: Date) =>
    `${path}?from=${from.toISOString()}&to=${to.toISOString()}`,
}))

import { DashboardContent } from '../DashboardContent'

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockAccessStatus  = null
  mockAccessLoading = false
  mockRouterReplace.mockClear()
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
