/**
 * Regression: DataTable's rows were wrapped in framer-motion's
 * <AnimatePresence mode="wait"><motion.tr>...</motion.tr></AnimatePresence> --
 * the exact same combination already root-caused as unreliable in
 * OnboardingTour.tsx (mode="wait" desyncing independent of nesting or click
 * speed) and confirmed live to crash the whole app with an
 * insertBefore/NotFoundError when an unrelated re-render (a dark/light
 * toggle click) landed while it held a reference to a row mid-exit. Rows are
 * now plain <tr> + a CSS fade-in with a per-row animation-delay -- no
 * framer-motion import left in the file at all, so this file doesn't need to
 * mock it (a real regression check: if AnimatePresence ever crept back in,
 * this test file provides no mock and importing the module would throw).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DataTable } from '../DataTable'

vi.mock('@/lib/lang-store', () => ({
  useT: () => ({ searchPlaceholder: 'Search...', noResultsFound: 'No results' }),
}))

interface Row { id: number; name: string }
const rows: Row[] = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
]
const columns = [
  { key: 'id' as const, header: 'ID' },
  { key: 'name' as const, header: 'Name' },
]

describe('DataTable — plain rows, no framer-motion', () => {
  it('renders one real <tr> per row with the fade-in class and a staggered delay', () => {
    const { container } = render(<DataTable data={rows} columns={columns} />)
    const bodyRows = container.querySelectorAll('tbody tr')
    expect(bodyRows.length).toBe(2)
    expect(bodyRows[0].className).toContain('animate-fade-in')
    expect((bodyRows[0] as HTMLElement).style.animationDelay).toBe('0ms')
    expect((bodyRows[1] as HTMLElement).style.animationDelay).toBe('20ms')
  })

  it('re-sorting swaps rows in place without throwing (the exact interaction the old AnimatePresence mode="wait" combo could desync)', () => {
    render(<DataTable data={rows} columns={columns} />)
    expect(() => fireEvent.click(screen.getByText('Name'))).not.toThrow()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
  })

  it('shows the empty message when there are no rows', () => {
    render(<DataTable data={[]} columns={columns} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
  })
})
