/**
 * OnboardingTour — the first-time guided tour (components/OnboardingTour.tsx).
 * Locks in: auto-open only for a never-toured user, the 6-step journey map,
 * skip/complete both persisting via /api/onboarding/complete, the final
 * CTA's real route (no invented "diagnostic" page), and that replay from
 * Settings (lib/onboarding-store.ts) reopens at step 1 regardless of where
 * the user left off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { OnboardingTour } from '../OnboardingTour'
import { useOnboardingStore } from '@/lib/onboarding-store'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
}))

vi.mock('@/lib/hooks/usePlatformName', () => ({
  usePlatformName: () => ({ platformName: 'Test Platform' }),
}))

// Full module set by default (matches every existing "all 6 steps" test);
// narrowed per-test below for the module/journey-gating tests.
let mockModules: string[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']
vi.mock('@/lib/hooks/useAvailableModules', () => ({
  useAvailableModules: () => ({ modules: mockModules, loading: false }),
}))

// Desktop by default (matchMedia isn't implemented in jsdom) — the spotlight
// layout itself is covered separately; these existing tests exercise the
// step walk/dismiss/replay logic, which is identical either way.
let mockIsDesktop = true
const mediaQueryList = {
  get matches() { return mockIsDesktop },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}
vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => mediaQueryList))

// jsdom has no ResizeObserver — the spotlight-position tracker only needs
// observe/disconnect to exist, never to actually fire in these tests (no
// Sidebar is mounted here, so there's never a real target to observe).
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })

const T = {
  onboardingStepLabel: 'Step {current} of {total}',
  onboardingSkip: 'Skip tour',
  onboardingBack: 'Back',
  onboardingNext: 'Next',
  onboardingCloseAria: 'Close guided tour',
  onboardingWelcomeTitle: 'Welcome to {platform}',
  onboardingWelcomeBody: 'welcome body',
  onboardingDiagnosticTitle: 'Start with your Diagnostic',
  onboardingDiagnosticBody: 'diagnostic body',
  onboardingLearnTitle: 'Learn',
  onboardingLearnBody: 'learn body',
  onboardingPracticeTitle: 'Practice with your Coach',
  onboardingPracticeBody: 'practice body',
  onboardingSimulateTitle: 'Simulate',
  onboardingSimulateBody: 'simulate body',
  onboardingProgressTitle: 'Measure your progress',
  onboardingProgressBody: 'progress body',
  onboardingStartDiagnostic: 'Start Diagnostic',
  onboardingFinish: 'Finish',
}
vi.mock('@/lib/lang-store', () => ({ useT: () => T }))

let mockUser: { id: number; onboarding_completed_at: string | null } | null = null
const markOnboardingComplete = vi.fn()
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ user: mockUser, markOnboardingComplete }),
}))

const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  useOnboardingStore.setState({ isOpen: false })
  mockUser = null
  mockModules = ['lms', 'coach', 'simulator', 'certification', 'second-brain']
  mockIsDesktop = true
  pushMock.mockClear()
  markOnboardingComplete.mockClear()
  fetchMock.mockClear()
})

describe('OnboardingTour — auto-open', () => {
  it('auto-opens for a user who has never dismissed the tour (onboarding_completed_at null)', () => {
    mockUser = { id: 1, onboarding_completed_at: null }
    render(<OnboardingTour />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })

  it('does not auto-open for a user who already dismissed it', () => {
    mockUser = { id: 2, onboarding_completed_at: '2026-01-01T00:00:00.000Z' }
    render(<OnboardingTour />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders nothing before auth resolves (user is null)', () => {
    mockUser = null
    render(<OnboardingTour />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('OnboardingTour — journey map and navigation', () => {
  beforeEach(() => {
    mockUser = { id: 1, onboarding_completed_at: null }
  })

  it('shows all 6 stage titles across the walk, in the canonical journey order', () => {
    render(<OnboardingTour />)
    const order = [
      'Welcome to Test Platform',
      'Start with your Diagnostic',
      'Learn',
      'Practice with your Coach',
      'Simulate',
      'Measure your progress',
    ]
    for (const title of order) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
      fireEvent.click(screen.getByText(/^(Next|Start Diagnostic)$/))
    }
  })

  it('shows Back only after the first step, and Start Diagnostic only on the last', () => {
    render(<OnboardingTour />)
    expect(screen.queryByText('Back')).not.toBeInTheDocument()
    expect(screen.queryByText('Start Diagnostic')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Back')).toBeInTheDocument()

    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Start Diagnostic')).toBeInTheDocument()
    expect(screen.queryByText('Next')).not.toBeInTheDocument()
  })

  it('Back returns to the previous step', () => {
    render(<OnboardingTour />)
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })

  it('stays in sync even under back-to-back clicks with no settling time between them', () => {
    // Regression: an earlier version wrapped this transition in
    // framer-motion's AnimatePresence mode="wait", which desynced the
    // title/body from the step counter and nav buttons -- confirmed live in
    // the browser, not just here. Plain keyed remounts render correctly on
    // every click, no matter how fast; there is nothing left to desync.
    render(<OnboardingTour />)
    const next = () => screen.getByText('Next')
    fireEvent.click(next())
    fireEvent.click(next())
    fireEvent.click(next())

    expect(screen.getByText('Step 4 of 6')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Practice with your Coach' })).toBeInTheDocument()
  })
})

describe('OnboardingTour — dismissal persists and never re-invents a diagnostic route', () => {
  beforeEach(() => {
    mockUser = { id: 1, onboarding_completed_at: null }
  })

  it('Skip tour closes it, marks it complete locally, and posts /api/onboarding/complete', () => {
    render(<OnboardingTour />)
    fireEvent.click(screen.getByText('Skip tour'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/onboarding/complete', expect.objectContaining({ method: 'POST' }))
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('Start Diagnostic (final step) dismisses and navigates to /journey -- the real page, not an invented diagnostic route', () => {
    render(<OnboardingTour />)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText(/^Next$/))
    fireEvent.click(screen.getByText('Start Diagnostic'))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith('/journey')
  })

  it('the close (X) button behaves exactly like Skip', () => {
    render(<OnboardingTour />)
    fireEvent.click(screen.getByLabelText('Close guided tour'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the tour the same way as Skip', () => {
    render(<OnboardingTour />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1)
  })
})

describe('OnboardingTour — replay from Settings', () => {
  it('opening the shared store directly re-shows the tour at step 1, regardless of prior progress', () => {
    mockUser = { id: 1, onboarding_completed_at: '2026-01-01T00:00:00.000Z' }
    render(<OnboardingTour />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => useOnboardingStore.getState().open())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })
})

describe('OnboardingTour — never points at UI this tenant does not have', () => {
  beforeEach(() => {
    mockUser = { id: 1, onboarding_completed_at: null }
  })

  it('skips the Learn/Practice/Simulate steps for a tenant with only Coach', () => {
    // hasJourney() needs >=2 real stages -- Coach alone isn't a journey, so
    // the Diagnostic/Progress steps (gated on journeyGate) drop too. Only
    // Welcome + Practice should remain: a step for a module this tenant
    // doesn't have would otherwise point at a sidebar item that isn't there.
    mockModules = ['coach']
    render(<OnboardingTour />)
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByRole('heading', { name: 'Practice with your Coach' })).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
    // No real Journey for this tenant -- the closing CTA can't claim to
    // "Start Diagnostic" (nothing found from onboardingStartDiagnostic).
    expect(screen.getByText('Finish')).toBeInTheDocument()
    expect(screen.queryByText('Start Diagnostic')).not.toBeInTheDocument()
  })

  it('a two-module tenant (a real journey) keeps the matching steps plus Diagnostic/Progress', () => {
    mockModules = ['lms', 'simulator']
    render(<OnboardingTour />)
    // Welcome, Diagnostic, Learn, Simulate, Progress -- Practice (Coach) is skipped.
    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByRole('heading', { name: 'Start with your Diagnostic' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByRole('heading', { name: 'Learn' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByRole('heading', { name: 'Simulate' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByRole('heading', { name: 'Measure your progress' })).toBeInTheDocument()
    expect(screen.getByText('Start Diagnostic')).toBeInTheDocument()
  })
})

describe('OnboardingTour — spotlight targeting (desktop, real nav item on screen)', () => {
  beforeEach(() => {
    mockUser = { id: 1, onboarding_completed_at: null }
  })

  it('spotlights the real sidebar nav link instead of the centered card, once one is on screen', async () => {
    // Stand in for Sidebar.tsx's own data-tour="nav-lms" link.
    const navLink = document.createElement('a')
    navLink.setAttribute('data-tour', 'nav-lms')
    Object.defineProperty(navLink, 'offsetParent', { get: () => document.body })
    navLink.getBoundingClientRect = () => ({
      top: 100, left: 0, width: 256, height: 40, right: 256, bottom: 140, x: 0, y: 100, toJSON() {},
    })
    document.body.appendChild(navLink)

    render(<OnboardingTour />)
    fireEvent.click(screen.getByText('Next')) // -> Diagnostic (journey, no sidebar stand-in) or Learn depending on order
    fireEvent.click(screen.getByText('Next')) // -> Learn (lms)
    expect(screen.getByRole('heading', { name: 'Learn' })).toBeInTheDocument()

    // Positioning is measured on a requestAnimationFrame, not synchronously.
    // Spotlight mode drops the shared journey-map/step-counter centered card
    // chrome entirely in favor of the floating card next to the target --
    // its click-blocker is a bare dialog with no visible border styling.
    await waitFor(() => expect(document.querySelector('.pointer-events-none')).toBeTruthy())

    document.body.removeChild(navLink)
  })

  it('falls back to the centered card when the real nav item is not on screen (e.g. mobile drawer closed)', () => {
    // No stand-in element appended -- querySelector finds nothing for any step.
    render(<OnboardingTour />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByRole('heading', { name: 'Learn' })).toBeInTheDocument()
    expect(document.querySelector('.pointer-events-none')).toBeFalsy()
  })

  it('never spotlights below the desktop breakpoint, even with a real target on screen', () => {
    mockIsDesktop = false
    const navLink = document.createElement('a')
    navLink.setAttribute('data-tour', 'nav-lms')
    Object.defineProperty(navLink, 'offsetParent', { get: () => document.body })
    navLink.getBoundingClientRect = () => ({
      top: 100, left: 0, width: 256, height: 40, right: 256, bottom: 140, x: 0, y: 100, toJSON() {},
    })
    document.body.appendChild(navLink)

    render(<OnboardingTour />)
    fireEvent.click(screen.getByText('Next'))
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByRole('heading', { name: 'Learn' })).toBeInTheDocument()
    expect(document.querySelector('.pointer-events-none')).toBeFalsy()

    document.body.removeChild(navLink)
  })
})
