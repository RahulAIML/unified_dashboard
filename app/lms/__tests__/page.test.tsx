/**
 * Regression tests for the "Dashboard KPI fixes" PDF's LMS section:
 *  - Estado de Matriculación (StatusBreakdown) is now against the full
 *    roster's possible completions (totalUsers * totalCourses), not
 *    totalEnrollments -- matching the same fix already applied to the
 *    aggregate/per-course completion rate.
 *  - The Cursos table's Usuarios column moved to right after Curso (was
 *    after En Progreso), matching the PDF's requested column order.
 *  - The completions trend chart's subtitle is now a static "last 30 days"
 *    label, not built from whatever range the global date picker selected.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { LmsStatusBreakdown } from '@/components/LmsStatusBreakdown'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))
vi.mock('@/lib/store', () => ({
  useDashboardStore: () => ({
    dateRange: { from: new Date('2026-08-01'), to: new Date('2026-08-24') },
    refreshKey: 0,
  }),
}))
vi.mock('@/components/DashboardHeader', () => ({
  DashboardHeader: ({ title, subtitle }: { title: string; subtitle: string }) => <div>{title}<p>{subtitle}</p></div>,
}))
vi.mock('@/lib/hooks/useClientBrand', () => ({
  useClientBrand: () => ({ chartColors: ['#ef4444', '#3b82f6', '#10b981'] }),
}))
vi.mock('@/components/charts/ActivityLineChart', () => ({
  ActivityLineChart: () => <div data-testid="activity-line-chart" />,
}))
vi.mock('@/lib/lang-store', () => ({
  useLangStore: () => ({ lang: 'es' }),
  useT: () => ({
    lmsTitle: 'LMS', lmsSub: 'sub',
    noDataAvailable: 'No data', errorLoading: 'Error loading', loading: 'Loading…',
    lmsNotConfigured: 'No LMS', lmsNotConfiguredHint: 'hint',
    enrolledUsers: 'Enrolled Users', enrolledUsersInfo: 'Number of users enrolled in at least one LMS course',
    completionRate: 'Completion Rate', completionRateInfo: 'Percentage of users who reached 100% completion',
    avgQuizScore: 'Avg Quiz Score', avgQuizScoreInfo: 'Average score of all graded quiz attempts on the LMS',
    modulesCompleted: 'Modules Finished', modulesCompletedInfo: 'Total number of modules finished',
    lmsOfUsers: 'of {total} users', lmsEnrollmentsTotal: 'across {count} enrollments',
    lmsCourses: 'Courses', lmsCoursesSub: 'courses with enrollments',
    lmsNoGradedAssessments: 'no graded assessments',
    lmsCompletionTrend: 'Courses finished per day', lmsCompletionTrendSub: 'Last 30 days',
    lmsEnrollmentStatus: 'Enrollment Status', lmsEnrollmentStatusSub: 'Current state across all enrollments',
    lmsStatusCompleted: 'Completed', lmsStatusInProgress: 'In Progress', lmsStatusNotStarted: 'Enrolled',
    lmsColCourse: 'Course', lmsColEnrolled: 'Enrolled', lmsColCompleted: 'Completed',
    lmsColInProgress: 'In Progress', lmsColTotal: 'Users',
    lmsNotGraded: 'Not graded', lmsExportRawLabel: 'Export raw (CSV)',
    navLms: 'LMS',
    noHistoricalComparison: 'no historical comparison', vsPrior: 'vs prior period',
    searchPlaceholder: 'Search…', noResultsFound: 'No results', showing: 'Showing', resultsWord: 'results',
    prev: 'Prev', pageLabel: 'Page', next: 'Next',
    exportCsv: 'Export CSV', exporting: 'Exporting…',
    exportTooltipEmptyPre: 'Nothing to export for ', exportTooltipEmptyPost: '',
    exportTooltipDownloadPre: 'Download ',
  }),
}))

const LMS_DATA = {
  configured: true,
  enrolledUsers: 81,
  totalUsers: 89,
  totalEnrollments: 196,
  totalCourses: 5,
  modulesCompleted: 127,
  inProgress: 30,
  notStarted: 39,
  completionRate: 28.5,
  avgQuizScore: 80.5,
  hasScoreData: true,
  completionTrend: [{ date: '2026-08-20', value: 3 }],
  courses: [
    { courseId: 'c1', name: 'Inducción Comercial', enrolled: 49, completed: 29, inProgress: 10, totalUsers: 89, completionRate: 32.6, avgScore: 79.9 },
  ],
}

let mockApiState: { data: unknown; loading: boolean; error: string | null } = { data: LMS_DATA, loading: false, error: null }
vi.mock('@/lib/hooks/useApi', () => ({
  useApi: () => mockApiState,
  buildApiUrl: (path: string) => path,
}))

async function loadPage() {
  vi.resetModules()
  const mod = await import('../page')
  return mod.default
}

describe('LmsPage — Cursos table column order (Usuarios right after Curso)', () => {
  // Higher timeout: this is the first test in the file to cold-import the
  // full page module graph (DataTable/ExportButton/SummaryCard/ChartCard),
  // which can exceed the 5s default under a heavily parallel full-suite run
  // even though it's fast (~1s) in isolation -- not a real behavior issue.
  it('renders headers in the order Curso, Usuarios, Inscritos, Completados, En Progreso, Tasa, Puntuación', async () => {
    mockApiState = { data: LMS_DATA, loading: false, error: null }
    const LmsPage = await loadPage()
    render(<LmsPage />)

    const headerRow = screen.getAllByRole('columnheader').map(el => el.textContent)
    expect(headerRow).toEqual([
      'Course', 'Users', 'Enrolled', 'Completed', 'In Progress', 'Completion Rate', 'Avg Quiz Score',
    ])
  }, 20_000)
})

describe('LmsPage — completions trend chart', () => {
  it('shows a static "last 30 days" subtitle, not a dynamic day-count built from the global date range', async () => {
    mockApiState = { data: LMS_DATA, loading: false, error: null }
    const LmsPage = await loadPage()
    render(<LmsPage />)

    expect(screen.getByText('Last 30 days')).toBeTruthy()
    // The old behavior concatenated e.g. "— last 23 days" from the store's
    // date range (Aug 1 -> Aug 24 in the mock above) -- must never appear.
    expect(screen.queryByText(/23 days/)).toBeNull()
  })
})

describe('StatusBreakdown', () => {
  it('divides each status by totalUsers * totalCourses (445), not totalEnrollments (196)', () => {
    render(<LmsStatusBreakdown data={LMS_DATA} />)

    // 127/445 = 28.5%, 30/445 = 6.7%, 39/445 = 8.8% -- NOT the old 64.8%/15.3%/19.9%
    // (which was completed/enrolled against totalEnrollments=196).
    expect(screen.getByText('28.5%')).toBeTruthy()
    expect(screen.getByText('6.7%')).toBeTruthy()
    expect(screen.getByText('8.8%')).toBeTruthy()
    expect(screen.queryByText('64.8%')).toBeNull()
  })

  it('shows an empty state rather than dividing by zero when the roster or course count is zero', () => {
    const { container } = render(<LmsStatusBreakdown data={{ ...LMS_DATA, totalUsers: 0 }} />)
    expect(container.querySelector('ul')).toBeNull()
  })
})
