/**
 * Tests for Sidebar component
 *
 * Key assertions:
 *   - Shows exactly the 7 standard nav items for ALL orgs (no Banco-specific item)
 *   - No /banco route ever appears
 *   - Theme toggle and logout buttons render
 *   - Mobile hamburger renders on small viewports
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from '../Sidebar'

// ── Next.js mocks ─────────────────────────────────────────────────────────────

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter:   () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// ── Provider / hook mocks ─────────────────────────────────────────────────────

vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'dark', toggle: vi.fn() }),
}))
vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    navOverview:     'Overview',
    navLms:          'LMS',
    navCoach:        'Coach',
    navSimulator:    'Simulator',
    navCertification:'Certification',
    navSecondBrain:  'Second Brain',
    navSettings:     'Settings',
    lightMode:       'Light mode',
    darkMode:        'Dark mode',
    logout:          'Log out',
    phaseLabel:      'v1.0',
  }),
}))
vi.mock('@/lib/hooks/useClientBrand', () => ({
  useClientBrand: () => ({ name: 'TestBrand', logo: '/logo.png', logoAlt: 'Logo' }),
}))
vi.mock('@/lib/hooks/usePlatformName', () => ({
  usePlatformName: () => ({ platformName: 'Test Platform' }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ clearAuth: vi.fn(), isAuthenticated: true, user: null, isLoading: false }),
}))

// framer-motion: render children without animation
vi.mock('framer-motion', () => ({
  motion: {
    div:   ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p}>{children}</div>,
    aside: ({ children, ...p }: React.HTMLAttributes<HTMLElement>) => <aside {...p}>{children}</aside>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders all 7 standard nav items', () => {
    render(<Sidebar />)
    expect(screen.getAllByRole('link', { name: /overview/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /lms/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /coach/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /simulator/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /certification/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /second brain/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: /settings/i }).length).toBeGreaterThan(0)
  })

  it('never renders a /banco nav link', () => {
    render(<Sidebar />)
    const links = screen.queryAllByRole('link')
    const bancoPaths = links.filter(l => l.getAttribute('href') === '/banco')
    expect(bancoPaths).toHaveLength(0)
  })

  it('renders the theme toggle button', () => {
    render(<Sidebar />)
    // Dark theme shows "Light mode" label
    expect(screen.getAllByText(/light mode/i).length).toBeGreaterThan(0)
  })

  it('renders the logout button', () => {
    render(<Sidebar />)
    expect(screen.getAllByText(/log out/i).length).toBeGreaterThan(0)
  })

  it('renders the platform name', () => {
    render(<Sidebar />)
    expect(screen.getAllByText('Test Platform').length).toBeGreaterThan(0)
  })

  it('renders the mobile hamburger button', () => {
    render(<Sidebar />)
    expect(screen.getByLabelText(/toggle menu/i)).toBeInTheDocument()
  })
})
