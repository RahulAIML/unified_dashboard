/**
 * Solution Journey page, extended with the Initial Diagnostic / Final Exam
 * bookend stages (demo-only mock data, lib/demo/journey-bookends.ts) --
 * covers:
 *  - the progress counter is computed from the actual rendered stages'
 *    statuses, never hardcoded
 *  - the before/after value story renders only when BOTH bookends exist
 *    (real mode, with neither, must not show half a comparison)
 *  - drilldown expand/collapse shows real fields, never an empty panel
 *  - real-mode (bookends both null) never fabricates a diagnostic/final exam
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a>,
}))
vi.mock('@/lib/store', () => ({
  useDashboardStore: () => ({
    dateRange: { from: new Date('2026-08-01'), to: new Date('2026-08-24') },
    refreshKey: 0,
  }),
}))
vi.mock('@/components/DashboardHeader', () => ({
  DashboardHeader: ({ title, subtitle }: { title: string; subtitle: string }) => <div>{title}<p>{subtitle}</p></div>,
}))

vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    journeyTitle: 'Solution Journey', journeySub: 'sub',
    journeyPhaseCognitive: 'Cognitive', journeyPhasePractice: 'Practice',
    journeyPhaseValidation: 'Validation', journeyPhaseExcellence: 'Excellence',
    journeyPhaseDiagnostic: 'Initial Assessment', journeyPhaseFinal: 'Final Assessment',
    journeyStageOf: 'Stage {n} of {total}',
    journeyActiveMembers: 'Active Members', journeyViewDetail: 'View detail',
    journeyNoStageData: 'No activity yet',
    journeyIndependentNote: 'independent note',
    journeySessions: 'Sessions', journeyCompleted: 'Completed',
    journeyDiagnosticLabel: 'Initial Diagnostic', journeyFinalExamLabel: 'Final Exam',
    journeyCurrentAvgLabel: 'Current Average', journeyScoreOutOf: 'out of',
    journeyStatusCompleted: 'Completed', journeyStatusInProgress: 'In progress', journeyStatusUpcoming: 'Upcoming',
    journeyShowDetail: 'Show detail', journeyHideDetail: 'Hide detail',
    journeyDetailStatus: 'Status', journeyDetailScore: 'Score', journeyFirstSession: 'First session',
    journeyProgressTitle: 'Journey progress',
    journeyProgressOfPre: '', journeyProgressOfMid: ' of ', journeyProgressOfPost: ' stages completed',
    journeyValueStoryTitle: 'Measured improvement', journeyPointsImprovement: 'point improvement',
    journeyTimelinePre: 'From ', journeyTimelinePost: ' until ',
    enrolledUsers: 'Enrolled Users', avgScore: 'Avg Score', errorLoading: 'Error loading',
    navLms: 'LMS', navCoach: 'Master Coach', navSimulator: 'Simulator',
    navCertification: 'Certification', navSecondBrain: 'Second Brain',
    colPassRate: 'Pass Rate', completionRate: 'Completion Rate',
  }),
}))

let mockAvailable = { modules: ['coach', 'simulator'], loading: false }
vi.mock('@/lib/hooks/useAvailableModules', () => ({
  useAvailableModules: () => mockAvailable,
}))

let mockCoach: Record<string, unknown> | null = null
let mockSim: Record<string, unknown> | null = null
let mockBookends: Record<string, unknown> | null = null
vi.mock('@/lib/hooks/useApi', () => ({
  useApi: (url: string | null) => {
    if (!url) return { data: null, loading: false, error: null }
    if (url.includes('journey-bookends')) return { data: mockBookends, loading: false, error: null }
    if (url.includes('solution=coach')) return { data: mockCoach, loading: false, error: null }
    if (url.includes('solution=simulator')) return { data: mockSim, loading: false, error: null }
    return { data: null, loading: false, error: null }
  },
  buildApiUrl: (path: string, _f: Date, _t: Date, extra: Record<string, unknown> = {}) =>
    `${path}?${new URLSearchParams(extra as Record<string, string>).toString()}`,
}))

import JourneyPage from '../page'

const DIAGNOSTIC = { kind: 'diagnostic', score: 5.5, maxScore: 10, sessions: 15, firstSessionDate: '2026-08-05', status: 'completed' }
const FINAL_EXAM = { kind: 'final_exam', score: 9.5, maxScore: 10, sessions: 2, firstSessionDate: '2026-10-25', status: 'completed' }

describe('Journey page — bookend stages (demo-only mock data)', () => {
  it('renders both bookends and the before/after value story when the API provides both', () => {
    mockBookends = { diagnostic: DIAGNOSTIC, finalExam: FINAL_EXAM }
    mockCoach = { totalEvaluations: 100, avgScore: 84, passRate: 78, prevTotalEvaluations: 80, prevAvgScore: 80, prevPassRate: 74, passedEvaluations: 78 }
    mockSim = null
    render(<JourneyPage />)

    expect(screen.getAllByText('Initial Diagnostic').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Final Exam').length).toBeGreaterThan(0)
    expect(screen.getByText('Measured improvement')).toBeTruthy()
    // 9.5 - 5.5 = 4.0 point improvement
    expect(screen.getByText(/\+4 point improvement/)).toBeTruthy()
  })

  it('never shows the value story or bookend sections when the real data source has neither (real mode, no fabrication)', () => {
    mockBookends = { diagnostic: null, finalExam: null }
    mockCoach = { totalEvaluations: 100, avgScore: 84, passRate: 78, prevTotalEvaluations: 80, prevAvgScore: 80, prevPassRate: 74, passedEvaluations: 78 }
    render(<JourneyPage />)

    expect(screen.queryAllByText('Initial Diagnostic').length).toBe(0)
    expect(screen.queryAllByText('Final Exam').length).toBe(0)
    expect(screen.queryByText('Measured improvement')).toBeNull()
  })
})

describe('Journey page — progress counter reflects the actual rendered stages', () => {
  it('counts a real stage with real activity as completed, one with none as upcoming', () => {
    mockBookends = { diagnostic: DIAGNOSTIC, finalExam: FINAL_EXAM }
    mockCoach = { totalEvaluations: 100, avgScore: 84, passRate: 78, prevTotalEvaluations: 80, prevAvgScore: 80, prevPassRate: 74, passedEvaluations: 78 }
    mockSim = { totalEvaluations: 0, avgScore: null, passRate: null, prevTotalEvaluations: 0, prevAvgScore: null, prevPassRate: null, passedEvaluations: 0 }
    render(<JourneyPage />)

    // 2 bookends (both completed) + coach (completed, has activity) + simulator
    // (upcoming, zero activity) = 3 of 4 stages completed.
    expect(screen.getByText('Journey progress')).toBeTruthy()
    expect(screen.getByText((_, el) => el?.textContent === '3 of 4 stages completed')).toBeTruthy()
  })
})

describe('Journey page — drilldown shows real fields, never an empty panel', () => {
  it('expands a bookend stage to reveal its real status/score/sessions/date', () => {
    mockBookends = { diagnostic: DIAGNOSTIC, finalExam: null }
    mockCoach = null
    mockSim = null
    render(<JourneyPage />)

    const cards = screen.getAllByText('Show detail')
    fireEvent.click(cards[0])

    expect(screen.getAllByText('Hide detail').length).toBeGreaterThan(0)
    expect(screen.getByText('First session')).toBeTruthy()
    expect(screen.getByText('2026-08-05')).toBeTruthy()
    expect(screen.getByText('5.5 / 10')).toBeTruthy()
  })
})

describe('Journey page — timeline', () => {
  it('shows the timeline only when a diagnostic exists', () => {
    mockBookends = { diagnostic: DIAGNOSTIC, finalExam: null }
    mockCoach = null
    mockSim = null
    render(<JourneyPage />)
    expect(screen.getByText(/From 2026-08-05 until/)).toBeTruthy()
  })

  it('omits the timeline when there is no diagnostic', () => {
    mockBookends = { diagnostic: null, finalExam: null }
    mockCoach = null
    mockSim = null
    render(<JourneyPage />)
    expect(screen.queryByText(/^From /)).toBeNull()
  })
})
