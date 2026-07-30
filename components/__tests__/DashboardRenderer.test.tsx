/**
 * Regression test for a real bug found visually testing the AI dashboard
 * builder: chart widgets (line_chart / bar_chart) rendered as empty boxes —
 * only the title, no bar. The underlying data was completely correct
 * (verified against the live API response); this was a pure CSS bug.
 *
 * Root cause: the outer row is `flex items-end`, and flexbox's align-items
 * only stretches a child to fill the cross axis under the default "stretch" —
 * "end" instead sizes each child to its own content, so the per-bar column had
 * an auto (0) height. The bar sets `height: X%`, and a percentage height
 * resolves against NOTHING when the container's height is auto (CSS spec, not
 * a browser quirk) — so every bar computed to 0px regardless of its data
 * value. jsdom (used by these tests) does not compute flex layout, so this
 * test asserts the FIX (h-full present on the per-bar column) rather than a
 * pixel height — the live confirmation (0px -> 86.4px after adding h-full)
 * was done directly in the browser, not here.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MiniChart, MiniTable, DashboardRenderer, humanizeConnector } from '../DashboardRenderer'

describe('MiniChart — the empty-chart bug', () => {
  it('gives every bar column a definite height (h-full) so the percentage height can resolve', () => {
    const { container } = render(
      <MiniChart series={[{ date: '2026-05', value: '24.00', sessions: 5 }]} />,
    )

    const column = container.querySelector('.flex-1')
    // This exact class is what the bug fix added. Without it, the bar's
    // percentage height is provably 0 regardless of the data value — see
    // file header for why that is a CSS fact, not an assumption.
    expect(column?.className).toContain('h-full')
  })

  it('renders one bar per data point, not zero', () => {
    const { container } = render(
      <MiniChart series={[{ date: '2026-05', value: 10 }, { date: '2026-06', value: 20 }]} />,
    )

    expect(container.querySelectorAll('.bg-primary').length).toBe(2)
  })

  it('reads total_sessions when there is no value field (bar_chart shape)', () => {
    const { container } = render(
      <MiniChart bar series={[{ simulator: 'A', total_sessions: 2 }, { simulator: 'B', total_sessions: 4 }]} />,
    )

    const bars = container.querySelectorAll('[style*="height"]')
    // B (4) is twice A (2), so B's bar must be taller than A's.
    const heightOf = (el: Element) => parseFloat((el as HTMLElement).style.height)
    expect(heightOf(bars[1])).toBeGreaterThan(heightOf(bars[0]))
  })

  it('floors every bar at 4% so a real-but-tiny value is still visible', () => {
    const { container } = render(
      <MiniChart series={[{ value: 0.001 }, { value: 1000 }]} />,
    )
    const bars = container.querySelectorAll('[style*="height"]')
    const heightOf = (el: Element) => parseFloat((el as HTMLElement).style.height)
    expect(heightOf(bars[0])).toBeGreaterThanOrEqual(4)
  })

  it('renders nothing (no crash) for an empty series', () => {
    const { container } = render(<MiniChart series={[]} />)
    expect(container.querySelectorAll('.bg-primary').length).toBe(0)
  })
})

describe('MiniTable', () => {
  it('renders real rows with their column values', () => {
    const { getByText } = render(
      <MiniTable rows={[{ simulator: 'Exkruthera', total_sessions: 2, avg_score: 60.5 }]} />,
    )
    expect(getByText('Exkruthera')).toBeTruthy()
    expect(getByText('60.50')).toBeTruthy()
  })

  it('shows a placeholder rather than an empty table for no rows', () => {
    const { container } = render(<MiniTable rows={[]} />)
    expect(container.querySelector('table')).toBeNull()
  })
})

describe('humanizeConnector', () => {
  it('never surfaces the raw internal pharma_* label to a manager', () => {
    expect(humanizeConnector('pharma_kpi')).not.toContain('pharma')
    expect(humanizeConnector('rolplay_app_sql')).not.toBe('rolplay_app_sql')
  })
})

describe('DashboardRenderer — end to end with real widget shapes', () => {
  it('renders a visible bar for a line_chart widget with real API data', () => {
    const config = {
      company: 'Takeda', slug: 'takeda', title: 'Takeda Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'trend', type: 'line_chart', title: 'Score Trend' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'trend', ok: true, series: [{ date: '2026-05', value: '24.00' }] }] }

    const { container } = render(<DashboardRenderer config={config} preview={preview} />)

    const bar = container.querySelector('.bg-primary') as HTMLElement | null
    expect(bar).not.toBeNull()
    expect(bar?.style.height).toBe('90%')
    expect(bar?.parentElement?.className).toContain('h-full')
  })

  it('shows a "no data" note only when the widget genuinely failed', () => {
    const config = {
      company: 'X', slug: 'x', title: 'X', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'w1', type: 'kpi_tile', title: 'Sessions' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'w1', ok: false, error: 'no data: no preview for X' }] }

    const { getByText } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(getByText(/no data/)).toBeTruthy()
  })
})
