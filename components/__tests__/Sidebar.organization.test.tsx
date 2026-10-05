/**
 * Regression: the Organization nav item (components/Sidebar.tsx) was gated
 * on hasPharmaAccess ONLY -- a rolplay-app tenant (e.g. Chinoin, 581 real
 * registered accounts) had /api/dashboard/organization's real rolplay-app
 * branch available but never a way to reach it, since the nav link itself
 * never rendered. Isolated from Sidebar.test.tsx so that file's "no
 * capabilities" baseline (access always undefined there) stays unaffected.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from '../Sidebar'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter:   () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark', toggle: vi.fn() }),
}))
vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    navOverview: 'Overview', navSettings: 'Settings', navOrganization: 'Organization',
    navConversational: 'Conversational', navActivities: 'Activities', navRanking: 'Ranking',
    navKpis: 'KPIs', navReports: 'Reports',
    lightMode: 'Light mode', darkMode: 'Dark mode', logout: 'Log out',
    phaseLabel: 'v1.0', dashboardWord: 'Dashboard', ariaToggleMenu: 'Toggle menu',
  }),
}))
vi.mock('@/lib/hooks/useClientBrand', () => ({
  useClientBrand: () => ({ name: 'TestBrand', logo: '/logo.png', logoAlt: 'Logo' }),
}))
vi.mock('@/lib/hooks/usePlatformName', () => ({
  usePlatformName: () => ({ platformName: 'Test Platform' }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ clearAuth: vi.fn(), isAuthenticated: true, user: { email: 'a@chinoin.com', role: 'user' }, isLoading: false }),
}))
vi.mock('@/lib/hooks/useAvailableModules', () => ({
  useAvailableModules: () => ({ modules: [] }),
}))
vi.mock('framer-motion', () => ({
  motion: {
    div:   ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p}>{children}</div>,
    aside: ({ children, ...p }: React.HTMLAttributes<HTMLElement>) => <aside {...p}>{children}</aside>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const useApiMock = vi.fn()
vi.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => useApiMock(...args) }))

describe('Sidebar — Organization nav item', () => {
  it('renders /organization for a rolplay-app tenant (hasRolplayAppAccess), not just pharma', () => {
    useApiMock.mockReturnValue({ data: { hasRolplayAppAccess: true }, loading: false, error: null })
    render(<Sidebar />)
    const links = screen.getAllByRole('link', { name: /organization/i })
    expect(links.some(l => l.getAttribute('href') === '/organization')).toBe(true)
  })

  it('still renders /organization for a pharma tenant (hasPharmaAccess)', () => {
    useApiMock.mockReturnValue({ data: { hasPharmaAccess: true }, loading: false, error: null })
    render(<Sidebar />)
    const links = screen.getAllByRole('link', { name: /organization/i })
    expect(links.some(l => l.getAttribute('href') === '/organization')).toBe(true)
  })

  it('hides /organization for a tenant with neither capability', () => {
    useApiMock.mockReturnValue({ data: {}, loading: false, error: null })
    render(<Sidebar />)
    expect(screen.queryAllByRole('link', { name: /organization/i })).toHaveLength(0)
  })

  it('keeps Conversational pharma-only even though Organization is now shared', () => {
    useApiMock.mockReturnValue({ data: { hasRolplayAppAccess: true }, loading: false, error: null })
    render(<Sidebar />)
    expect(screen.queryAllByRole('link', { name: /conversational/i })).toHaveLength(0)
  })
})
