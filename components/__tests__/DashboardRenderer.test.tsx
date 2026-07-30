/**
 * MiniChart was a placeholder that drew flat solid-color rectangles for BOTH
 * line_chart and bar_chart widget types (a "line chart" never actually drew a
 * line — only a lighter bar color), with no axis and no visible value on a
 * small bar. That became a real problem on real data: a live cross-check
 * against a client with a skewed distribution (one simulator at 129 sessions,
 * others at 8/4/3) rendered the three smaller bars as indistinguishable
 * slivers with nothing indicating their actual counts. MiniChart now renders
 * real recharts LineChart/BarChart components (matching the house style used
 * by components/charts/ModuleBarChart.tsx and ActivityLineChart.tsx), with an
 * always-on value label so a small bar's number stays legible.
 *
 * recharts' ResponsiveContainer measures its DOM container to size the chart,
 * and jsdom never reports a non-zero size (no layout engine, no
 * ResizeObserver) — confirmed directly: rendering MiniChart against jsdom
 * produces a ResponsiveContainer with width/height 0 and no child SVG at all.
 * Rather than fight jsdom with a fake ResizeObserver, these tests mock
 * `recharts` itself (matching this codebase's existing pattern of mocking
 * whole chart components away in components/__tests__ — see vitest.setup.ts
 * mocking ActivityLineChart/ModuleBarChart/DonutChart) and assert on the real
 * thing under our control: which chart type is chosen, and what data reaches
 * it — including that a small value like 3 arrives completely unchanged
 * alongside a much larger 129, since that's what makes it legible via the
 * label once recharts actually draws it.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MiniChart, MiniTable, DashboardRenderer, humanizeConnector } from '../DashboardRenderer'

vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const ChartStub = (testId: string) =>
    function Stub({ data, children }: { data: unknown[]; children?: React.ReactNode }) {
      return (
        <div data-testid={testId} data-points={JSON.stringify(data)}>
          {children}
        </div>
      )
    }
  return {
    ResponsiveContainer: Pass,
    BarChart: ChartStub('bar-chart'),
    LineChart: ChartStub('line-chart'),
    Bar: () => null,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    LabelList: () => null,
  }
})

function chartData(container: HTMLElement, testId: string): { label: string; value: number }[] {
  const el = container.querySelector(`[data-testid="${testId}"]`)
  if (!el) return []
  return JSON.parse(el.getAttribute('data-points') ?? '[]')
}

describe('MiniChart', () => {
  it('renders a real line for a line_chart widget (bar=false), not a bar', () => {
    const { container } = render(
      <MiniChart series={[{ date: '2026-05', value: '24.00' }]} />,
    )
    expect(container.querySelector('[data-testid="line-chart"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="bar-chart"]')).toBeNull()
  })

  it('renders a real bar chart for a bar_chart widget (bar=true)', () => {
    const { container } = render(
      <MiniChart bar series={[{ simulator: 'A', total_sessions: 2 }]} />,
    )
    expect(container.querySelector('[data-testid="bar-chart"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="line-chart"]')).toBeNull()
  })

  it('extracts value from the `value` field when present', () => {
    const { container } = render(<MiniChart series={[{ date: '2026-05', value: '24.00' }]} />)
    const data = chartData(container, 'line-chart')
    expect(data[0].value).toBe(24)
  })

  it('reads total_sessions when there is no value field (bar_chart shape)', () => {
    const { container } = render(
      <MiniChart bar series={[{ simulator: 'A', total_sessions: 2 }, { simulator: 'B', total_sessions: 4 }]} />,
    )
    const data = chartData(container, 'bar-chart')
    expect(data.map(d => d.value)).toEqual([2, 4])
  })

  it('keeps a small value exact and unclamped next to a much larger one, so its label stays legible', () => {
    // The failure mode this guards against: a 129-vs-3 session ratio made the
    // smaller bars visually invisible under pure height-based rendering. The
    // fix is an always-on value label (LabelList) — which can only show the
    // correct number if the real, unrounded value actually reaches the chart.
    const { container } = render(
      <MiniChart bar series={[
        { simulator: 'Siigo 1', total_sessions: 129 },
        { simulator: 'Siigo 2', total_sessions: 8 },
        { simulator: 'Siigo 3', total_sessions: 4 },
        { simulator: 'Siigo 4', total_sessions: 3 },
      ]} />,
    )
    const data = chartData(container, 'bar-chart')
    expect(data.map(d => d.value)).toEqual([129, 8, 4, 3])
  })

  it('carries the real label (not the truncated tick) alongside each value', () => {
    const { container } = render(
      <MiniChart bar series={[{ simulator: 'A Very Long Simulator Name', total_sessions: 5 }]} />,
    )
    const data = chartData(container, 'bar-chart')
    expect(data[0].label).toBe('A Very Long Simulator Name')
  })

  it('shows a placeholder rather than an empty chart for no data', () => {
    const { container, getByText } = render(<MiniChart series={[]} />)
    expect(getByText('—')).toBeTruthy()
    expect(container.querySelector('[data-testid="bar-chart"]')).toBeNull()
    expect(container.querySelector('[data-testid="line-chart"]')).toBeNull()
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
  it('renders a real chart with the right data for a line_chart widget', () => {
    const config = {
      company: 'Takeda', slug: 'takeda', title: 'Takeda Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'trend', type: 'line_chart', title: 'Score Trend' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'trend', ok: true, series: [{ date: '2026-05', value: '24.00' }] }] }

    const { container } = render(<DashboardRenderer config={config} preview={preview} />)

    const chart = container.querySelector('[data-testid="line-chart"]')
    expect(chart).not.toBeNull()
    expect(chartData(container, 'line-chart')[0].value).toBe(24)
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
