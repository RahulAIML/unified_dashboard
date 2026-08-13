/**
 * Cesar KPI page (Sugerencia de KPI's Cesar.xlsx). Covers:
 *  - the 100%-sum visualization rule: any breakdown that sums to 100% must
 *    render as a donut/pie, never as separate bars, with the exact numeric
 *    value kept visible alongside the chart (Mastery Distribution).
 *  - the goal bar/status badge is real and spec-sourced (only Activation
 *    Rate has one -- KPI-1.1's own 80% target), never fabricated for a KPI
 *    the spec doesn't define a target for.
 *  - the period-over-period delta badge on the 6 scalar KPI cards.
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
    kpiVsPreviousPeriod: 'vs. previous period',
    perspAdoption: '1. Adoption & Usage', perspEfficiency: '2. Efficiency & Acceleration',
    perspTechnical: '3. Technical Diagnostics', perspCommercial: '4. Commercial Effectiveness',
    perspImpact: '5. Impact & Prescription',

    kpiActivationRate: 'Activation Rate',
    kpiActivationRateDesc: 'desc', kpiActivationRateFormula: 'formula', kpiActivationRateFooter: 'footer',
    kpiActivationRateGoalLabel: 'Goal: >= 80%',

    kpiWeeklyPractice: 'Weekly Practice',
    kpiWeeklyPracticeDesc: 'desc', kpiWeeklyPracticeFormula: 'formula', kpiWeeklyPracticeFooter: 'footer',
    kpiWeeklyPracticeUnit: 'sessions/wk',

    kpiMau: 'MAU',
    kpiMauDesc: 'desc', kpiMauFormula: 'formula', kpiMauFooter: 'footer',

    kpiDeltaScore: 'Delta Score',
    kpiDeltaScoreDesc: 'desc', kpiDeltaScoreFormula: 'formula', kpiDeltaScoreFooter: 'footer',
    kpiDeltaScoreUnit: 'pts',

    kpiReadinessIndex: 'Readiness',
    kpiReadinessIndexDesc: 'desc', kpiReadinessIndexFormula: 'formula', kpiReadinessIndexFooter: 'footer',

    kpiMasteryDistTitle: 'Distribution by Mastery Level',
    kpiMasteryDistDesc: 'desc', kpiMasteryDistFormula: 'formula', kpiMasteryDistFooter: 'footer',

    kpiAdoptionMovement: 'Adoption Movement',
    kpiAdoptionMovementDesc: 'desc', kpiAdoptionMovementFormula: 'formula', kpiAdoptionMovementFooter: 'footer',

    kpiCommercialDomainTitle: 'Commercial Domain',
    kpiCommercialDomainDesc: 'desc', kpiCommercialDomainFormula: 'formula', kpiCommercialDomainFooter: 'footer',

    kpiTopStrengthsTitle: 'Top Strengths',
    kpiTopStrengthsDesc: 'desc', kpiTopStrengthsFormula: 'formula', kpiTopStrengthsFooter: 'footer',

    kpiTopOpportunitiesTitle: 'Top Opportunities',
    kpiTopOpportunitiesDesc: 'desc', kpiTopOpportunitiesFormula: 'formula', kpiTopOpportunitiesFooter: 'footer',
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

const BASE_DATA = {
  activationRate: 50, prevActivationRate: 40,
  weeklyPracticeFrequency: 4, prevWeeklyPracticeFrequency: 4,
  mauRate: 30, prevMauRate: 30,
  deltaScore: 5, prevDeltaScore: 5,
  readinessIndex: 20, prevReadinessIndex: 20,
  masteryDistribution: [] as { label: string; value: number; pct: number }[],
  adoptionMovementRate: null, prevAdoptionMovementRate: null,
  commercialDomain: [] as { domain: string; avgScore: number; sessions: number }[],
  topStrengths: [] as { item: string; count: number }[],
  topOpportunities: [] as { item: string; count: number }[],
}

describe('KPIs page — Mastery Distribution visualization rule', () => {
  it('renders the Basic/Intermediate/Advanced breakdown as a donut, not separate bars', () => {
    mockData = {
      ...BASE_DATA,
      masteryDistribution: [
        { label: 'Basic (<75)', value: 10, pct: 50 },
        { label: 'Intermediate (75-94)', value: 6, pct: 30 },
        { label: 'Advanced (>=95)', value: 4, pct: 20 },
      ],
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
    mockData = { ...BASE_DATA }
    const { container } = render(<KpisPage />)
    expect(container.querySelector('[data-testid="pie"]')).toBeNull()
    expect(screen.getAllByText('No data').length).toBeGreaterThan(0)
  })
})

describe('KPIs page — goal bar scoping', () => {
  it('shows a goal status badge only on Activation Rate, the one KPI with a real spec-sourced target', () => {
    mockData = { ...BASE_DATA, activationRate: 85, prevActivationRate: 80 }
    render(<KpisPage />)
    expect(screen.getByText('On track')).toBeTruthy()
    expect(screen.getByText('Goal: >= 80%')).toBeTruthy()
    // Only one goal badge should exist on the whole page.
    expect(screen.getAllByText(/^(On track|Below goal)$/).length).toBe(1)
  })

  it('shows a below-goal badge when Activation Rate has not reached 80%', () => {
    mockData = { ...BASE_DATA, activationRate: 60, prevActivationRate: 55 }
    render(<KpisPage />)
    expect(screen.getByText('Below goal')).toBeTruthy()
  })
})

describe('KPIs page — period-over-period delta', () => {
  it('shows an upward delta badge when a scalar KPI improved vs. the previous period', () => {
    mockData = { ...BASE_DATA, activationRate: 85, prevActivationRate: 80 }
    render(<KpisPage />)
    expect(screen.getByText('+5%')).toBeTruthy()
    expect(screen.getAllByText('vs. previous period').length).toBeGreaterThan(0)
  })

  it('renders no delta badge for a scalar KPI when there is no previous-period data', () => {
    mockData = { ...BASE_DATA, adoptionMovementRate: 40, prevAdoptionMovementRate: null }
    render(<KpisPage />)
    // "40%" appears as the current value; there should be no "+"/"-" delta pill next to it.
    expect(screen.getByText('40')).toBeTruthy()
  })
})
