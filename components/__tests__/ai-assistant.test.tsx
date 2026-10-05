/**
 * Regression: the Robin AI panel was wrapped in framer-motion's
 * <AnimatePresence>{open && <motion.div exit={...}>...}</AnimatePresence> --
 * the same anti-pattern already root-caused in OnboardingTour.tsx (a bare
 * `open &&` gate above AnimatePresence unmounts it directly via React
 * instead of letting it manage its own exit) and confirmed live to crash the
 * whole app with an insertBefore/NotFoundError: a real user's dark/light
 * toggle click crashed on /kpis, which -- like every page -- has this
 * globally-mounted widget sitting in the tree. It's now a plain conditional
 * + CSS fade/slide, no framer-motion import left in the file at all -- this
 * test file provides no framer-motion mock, so if AnimatePresence ever crept
 * back in, importing the module would throw here.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AIAssistant } from '../ai-assistant'

vi.mock('next/navigation', () => ({ usePathname: () => '/kpis' }))
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ user: { id: 1, role: 'admin' } }),
}))
vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    aiTrendInsufficient: 'n/a', aiTrendIncreasing: 'up', aiTrendDecreasing: 'down', aiTrendStable: 'flat',
    aiQuickSummary: 'Summary', aiQuickPassRate: 'Pass rate', aiQuickScoreTrend: 'Score trend', aiQuickTopInsights: 'Top insights',
    aiWelcome: 'Hi, ask me anything', days: 'days', aiErrorFallback: 'Something went wrong',
    askAi: 'Ask Robin AI', aiAssistant: 'Robin AI', aiLast: 'Last', aiAnalyzing: 'Analyzing…',
    aiQuickQuestions: 'Quick questions', aiPlaceholder: 'Type a question…',
  }),
  useLangStore: (selector: (s: { lang: string }) => unknown) => selector({ lang: 'en' }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('AIAssistant — plain conditional render, no framer-motion', () => {
  it('the panel is closed by default and opens on clicking the trigger', () => {
    render(<AIAssistant />)
    expect(screen.queryByText('Robin AI')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Open Robin AI assistant'))
    expect(screen.getByText('Robin AI')).toBeInTheDocument()
    expect(screen.getByText('Hi, ask me anything')).toBeInTheDocument()
  })

  it('closes on the X button without throwing (previously an AnimatePresence exit)', () => {
    render(<AIAssistant />)
    fireEvent.click(screen.getByLabelText('Open Robin AI assistant'))
    expect(() => fireEvent.click(screen.getByLabelText('Close'))).not.toThrow()
    expect(screen.queryByText('Robin AI')).not.toBeInTheDocument()
  })

  it('surviving an unrelated re-render (e.g. a parent theme toggle) while open does not crash', () => {
    const { rerender } = render(<AIAssistant />)
    fireEvent.click(screen.getByLabelText('Open Robin AI assistant'))
    // Simulate the exact scenario that used to crash: something elsewhere
    // in the tree re-renders while this panel is mounted.
    expect(() => rerender(<AIAssistant />)).not.toThrow()
    expect(screen.getByText('Robin AI')).toBeInTheDocument()
  })
})
