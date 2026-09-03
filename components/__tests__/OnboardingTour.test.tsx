/**
 * OnboardingTour — the first-time guided tour (components/OnboardingTour.tsx).
 * Locks in: auto-open only for a never-toured user, the 6-step journey map,
 * skip/complete both persisting via /api/onboarding/complete, the final
 * CTA's real route (no invented "diagnostic" page), and that replay from
 * Settings (lib/onboarding-store.ts) reopens at step 1 regardless of where
 * the user left off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { OnboardingTour } from '../OnboardingTour'
import { useOnboardingStore } from '@/lib/onboarding-store'

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div {...p}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

vi.mock('@/lib/hooks/usePlatformName', () => ({
  usePlatformName: () => ({ platformName: 'Test Platform' }),
}))

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
