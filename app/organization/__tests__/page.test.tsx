/**
 * Regression: OrganizationPage previously only ever fetched for
 * hasPharmaAccess and always rendered the admin/member hierarchy UI. A
 * rolplay-app tenant (Chinoin: 581 real registered accounts, only 1 with a
 * session) now gets real data from /api/dashboard/organization's rolplay-app
 * branch (lib/bridge-rolplay-app.ts's rolplayAppOrganization) -- this locks
 * in that the page (a) actually fetches for hasRolplayAppAccess and (b)
 * renders the flat-roster view (no admin hierarchy exists for this
 * connector), not the pharma grouped-by-admin UI.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import OrganizationPage from '../page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))
vi.mock('@/lib/store', () => ({
  useDashboardStore: () => ({ dateRange: { from: new Date('2026-08-01'), to: new Date('2026-08-24') }, refreshKey: 0 }),
}))
vi.mock('@/components/DashboardHeader', () => ({
  DashboardHeader: ({ title, subtitle }: { title: string; subtitle: string }) => <div>{title}<p>{subtitle}</p></div>,
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ user: { email: 'a@chinoin.com', role: 'user' } }),
}))
vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    orgTitle: 'Organization', orgSub: 'Hierarchical structure', orgSubFlat: 'Registered users and their real activity',
    orgMembers: 'members', orgMembersInfo: 'info', orgAdmins: 'Administrators', orgAdminsInfo: 'info',
    orgSupervisors: 'Supervisors', orgSupervisorsInfo: 'info', orgUnassigned: 'Unassigned',
    orgRegistered: 'Registered', orgRegisteredInfo: 'info', orgNeverPracticed: 'Never Practiced',
    orgNeverPracticedInfo: 'info', orgModulesUsed: 'Modules used', orgSessionsShort: 'sessions',
    orgLastSession: 'Last session', orgNoSessionYet: 'No sessions yet',
    orgStatusActive: 'Active', orgStatusDisabled: 'Disabled',
    navCoach: 'Master Coach', navSimulator: 'Practice Simulator', navCertification: 'Certification',
    noDataAvailable: 'No data available',
  }),
}))

let mockApiState: { data: unknown; loading: boolean; error: string | null }
vi.mock('@/lib/hooks/useApi', () => ({
  useApi: (url: string | null) => {
    if (url && url.includes('access-status')) return { data: { hasRolplayAppAccess: true }, loading: false, error: null }
    return mockApiState
  },
  buildApiUrl: (path: string) => path,
}))

describe('OrganizationPage — rolplay-app flat roster', () => {
  beforeEach(() => {
    mockApiState = { data: null, loading: true, error: null }
  })

  it('renders the flat roster (name/email/department) instead of the pharma admin hierarchy', () => {
    mockApiState = {
      data: {
        totalMembers: 2, totalAdmins: 0, totalSupervisors: 0,
        members: [
          { id: 1, fullName: 'Claudia Salinas', email: 'claudia@chinoin.com', designation: 'Gerente', adminId: null, department: 'Rinitis', status: 'active', sessions: 3, modulesUsed: ['coach'], lastSessionAt: '2026-09-01', lastLoginAt: null, createdOn: '2026-09-01' },
          { id: 2, fullName: 'Tester Chinoin', email: 'tester@chinoin.com', designation: 'staff', adminId: null, department: null, status: 'active', sessions: 0, modulesUsed: [], lastSessionAt: null, lastLoginAt: null, createdOn: '2026-08-12' },
        ],
        admins: [],
      },
      loading: false, error: null,
    }
    render(<OrganizationPage />)

    expect(screen.getByText('Claudia Salinas')).toBeInTheDocument()
    expect(screen.getByText(/claudia@chinoin.com/)).toBeInTheDocument()
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()
  })

  it('shows the correct never-practiced count', () => {
    mockApiState = {
      data: {
        totalMembers: 2, totalAdmins: 0, totalSupervisors: 0,
        members: [
          { id: 1, fullName: 'A', email: 'a@x.com', designation: null, adminId: null, status: 'active', sessions: 3, modulesUsed: ['coach'], lastSessionAt: '2026-09-01' },
          { id: 2, fullName: 'B', email: 'b@x.com', designation: null, adminId: null, status: 'active', sessions: 0, modulesUsed: [], lastSessionAt: null },
        ],
        admins: [],
      },
      loading: false, error: null,
    }
    render(<OrganizationPage />)
    // The Never Practiced metric card shows the count of zero-session members.
    // MetricCard nests label and value a few levels apart, so walk up to the
    // card's own content wrapper (className="p-5 sm:p-6") rather than the
    // immediate parent, which only wraps the label + info button.
    const card = screen.getByText('Never Practiced').closest('.p-5')
    expect(card?.textContent).toContain('1')
  })

  it('shows a Disabled badge for a disabled account', () => {
    mockApiState = {
      data: {
        totalMembers: 1, totalAdmins: 0, totalSupervisors: 0,
        members: [{ id: 1, fullName: 'A', email: 'a@x.com', designation: null, adminId: null, status: 'disabled', sessions: 0, modulesUsed: [], lastSessionAt: null }],
        admins: [],
      },
      loading: false, error: null,
    }
    render(<OrganizationPage />)
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })

  it('shows "No sessions yet" for a registered user who never practiced', () => {
    mockApiState = {
      data: {
        totalMembers: 1, totalAdmins: 0, totalSupervisors: 0,
        members: [{ id: 1, fullName: 'A', email: 'a@x.com', designation: null, adminId: null, status: 'active', sessions: 0, modulesUsed: [], lastSessionAt: null }],
        admins: [],
      },
      loading: false, error: null,
    }
    render(<OrganizationPage />)
    expect(screen.getByText('No sessions yet')).toBeInTheDocument()
  })
})
