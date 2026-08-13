/**
 * Ticket: any breakdown that sums to 100% must render as a donut/pie/
 * stacked bar, never as separate bars, with the exact numeric value kept
 * visible alongside the chart. Mastery Distribution (Basic/Intermediate/
 * Advanced) used to render as three individual progress-bar divs.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))
vi.mock('@/lib/store', () => ({
  useDashboardStore: () => ({
    dateRange: { from: new Date('2026-04-06'), to: new Date('2026-05-06') },
    selectedSolution: 'all',
    refreshKey: 0,
  }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ user: { id: 1, email: 'u@test.com' }, isLoading: false }),
}))
vi.mock('@/components/DashboardHeader', () => ({
  DashboardHeader: ({ title }: { title: string }) => <div>{title}</div>,
}))
vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    navKpis: 'KPIs', kpisSubtitle: 'Cesar KPIs', noDataAvailable: 'No data',
    kpiActivationRate: 'Activation Rate', kpiActivationRateInfo: 'info',
    kpiWeeklyPractice: 'Weekly Practice', kpiWeeklyPracticeInfo: 'info',
    kpiMau: 'MAU', kpiMauInfo: 'info',
    kpiDeltaScore: 'Delta Score', kpiDeltaScoreInfo: 'info',
    kpiReadinessIndex: 'Readiness', kpiReadinessIndexInfo: 'info',
    kpiMasteryDistTitle: 'Distribution by Mastery Level', kpiMasteryDistSub: 'sub',
    kpiAdoptionMovement: 'Adoption Movement', kpiAdoptionMovementHint: 'hint',
    kpiCommercialDomainTitle: 'Commercial Domain', kpiCommercialDomainSub: 'sub',
    kpiTopStrengthsTitle: 'Top Strengths', kpiTopStrengthsSub: 'sub',
    kpiTopOpportunitiesTitle: 'Top Opportunities', kpiTopOpportunitiesSub: 'sub',
  }),
}))
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    ResponsiveContainer: Pass,
    PieChart: Pass,
    Pie: ({ data, children }: { data: unknown[]; children?: React.ReactNode }) => (
      <div data-testid="pie" data-points={JSON.stringify(data)}>{children}</div>
    ),
    Cell: () => null,
    Tooltip: () => null,
  }
})

let mockData: Record<string, unknown> | null = null
vi.mock('@/lib/hooks/useApi', () => ({
  useApi: (url: string | null) => {
    if (url === '/api/auth/access-status') return { data: { hasRolplayAppAccess: true }, loading: false }
    return { data: mockData, loading: false }
  },
  buildApiUrl: (path: string) => path,
}))

import KpisPage from '../page'

describe('KPIs page — Mastery Distribution visualization rule', () => {
  it('renders the Basic/Intermediate/Advanced breakdown as a donut, not separate bars', () => {
    mockData = {
      activationRate: 50, weeklyPracticeFrequency: 4, mauRate: 30,
      deltaScore: 5, readinessIndex: 20,
      masteryDistribution: [
        { label: 'Basic (<75)', value: 10, pct: 50 },
        { label: 'Intermediate (75-94)', value: 6, pct: 30 },
        { label: 'Advanced (>=95)', value: 4, pct: 20 },
      ],
      adoptionMovementRate: null, commercialDomain: [], topStrengths: [], topOpportunities: [],
    }
    const { container } = render(<KpisPage />)

    const pie = container.querySelector('[data-testid="pie"]')
    expect(pie).not.toBeNull()
    const points = JSON.parse(pie!.getAttribute('data-points') ?? '[]')
    expect(points.map((p: { name: string; value: number }) => [p.name, p.value])).toEqual([
      ['Basic (<75)', 10], ['Intermediate (75-94)', 6], ['Advanced (>=95)', 4],
    ])

    // The exact value + share must still be visible as text, not just the chart.
    expect(screen.getByText('10 (50%)')).toBeTruthy()
    expect(screen.getByText('6 (30%)')).toBeTruthy()
    expect(screen.getByText('4 (20%)')).toBeTruthy()
  })

  it('shows an empty state rather than an empty chart when there is no mastery data', () => {
    mockData = {
      activationRate: null, weeklyPracticeFrequency: null, mauRate: null,
      deltaScore: null, readinessIndex: null,
      masteryDistribution: [],
      adoptionMovementRate: null, commercialDomain: [], topStrengths: [], topOpportunities: [],
    }
    const { container } = render(<KpisPage />)
    expect(container.querySelector('[data-testid="pie"]')).toBeNull()
    expect(screen.getAllByText('No data').length).toBeGreaterThan(0)
  })
})
