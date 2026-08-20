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
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { MiniChart, MiniDonut, MiniJourney, MiniTable, ReportsTable, DashboardRenderer, humanizeConnector } from '../DashboardRenderer'
import { useLangStore } from '@/lib/lang-store'

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
    PieChart: Pass,
    Bar: ({ dataKey, name }: { dataKey?: string; name?: string }) =>
      <div data-testid="bar-series" data-key={dataKey} data-name={name} />,
    Line: () => null,
    Pie: ({ data, children }: { data: unknown[]; children?: React.ReactNode }) => (
      <div data-testid="pie" data-points={JSON.stringify(data)}>{children}</div>
    ),
    Cell: () => null,
    Legend: () => <div data-testid="legend" />,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    LabelList: () => null,
  }
})

function chartData(container: HTMLElement, testId: string): { label: string; value: number; passedValue: number | null }[] {
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

  it('renders only a single Total bar series when no passed-count data is available', () => {
    const { container } = render(
      <MiniChart bar series={[{ simulator: 'A', total_sessions: 10 }]} />,
    )
    expect(container.querySelectorAll('[data-testid="bar-series"]').length).toBe(1)
  })

  it('renders a grouped Total-vs-Passed bar chart when a passed count is present', () => {
    // Mirrors the real hand-built Overview page's "Sessions by Use Case"
    // chart (Passed vs Total Sessions) — several connectors now return a
    // passed_sessions/passed count alongside the total.
    const { container } = render(
      <MiniChart bar series={[{ simulator: 'A', total_sessions: 10, passed_sessions: 8 }]} />,
    )
    const series = container.querySelectorAll('[data-testid="bar-series"]')
    expect(series.length).toBe(2)
    const keys = Array.from(series).map(s => s.getAttribute('data-key'))
    expect(keys).toEqual(['value', 'passedValue'])
    const data = chartData(container, 'bar-chart')
    expect(data[0].passedValue).toBe(8)
  })
})

describe('MiniDonut', () => {
  it('renders a slice per category with the real value', () => {
    const { container } = render(
      <MiniDonut rows={[{ simulator: 'A', total_sessions: 10 }, { simulator: 'B', total_sessions: 5 }]} />,
    )
    const pieData = JSON.parse(container.querySelector('[data-testid="pie"]')?.getAttribute('data-points') ?? '[]')
    const byLabel = new Map(pieData.map((d: { label: string; value: number }) => [d.label, d.value]))
    expect(byLabel.get('A')).toBe(10)
    expect(byLabel.get('B')).toBe(5)
  })

  it('renders an exact Passed/Failed split for an approval_breakdown widget', () => {
    const { container } = render(
      <MiniDonut rows={[{ label: 'Passed', value: 9 }, { label: 'Failed', value: 6 }]} />,
    )
    const pieData = JSON.parse(container.querySelector('[data-testid="pie"]')?.getAttribute('data-points') ?? '[]')
    const byLabel = new Map(pieData.map((d: { label: string; value: number }) => [d.label, d.value]))
    expect(byLabel.get('Passed')).toBe(9)
    expect(byLabel.get('Failed')).toBe(6)
  })

  it('collapses a long tail into a single "Other" slice so it stays legible', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ activity: `Activity ${i}`, total_sessions: 10 - i }))
    const { container } = render(<MiniDonut rows={rows} />)
    const pieData = JSON.parse(container.querySelector('[data-testid="pie"]')?.getAttribute('data-points') ?? '[]')
    // 7 real slices + 1 "Other" bucket, not all 10.
    expect(pieData.length).toBe(8)
    const other = pieData.find((d: { label: string }) => d.label === 'Otro')
    expect(other).toBeTruthy()
  })

  it('shows a placeholder rather than an empty chart for no rows', () => {
    const { container, getByText } = render(<MiniDonut rows={[]} />)
    expect(getByText('—')).toBeTruthy()
    expect(container.querySelector('[data-testid="pie"]')).toBeNull()
  })
})

describe('MiniJourney', () => {
  it('renders one stage per real module with its own count and pass rate', () => {
    const { getByText } = render(
      <MiniJourney rows={[
        { module: 'simulator', label: 'Practice Simulator', phase: 'practice', total_sessions: 144, pass_rate: 36.8 },
        { module: 'certification', label: 'Certification', phase: 'validation', total_sessions: 3, pass_rate: 66.7 },
      ]} />,
    )
    expect(getByText('Practice Simulator')).toBeTruthy()
    expect(getByText('144')).toBeTruthy()
    // Default test language is Spanish (SSR_LANG='es' — see lib/lang-store.ts).
    expect(getByText('36.8% Tasa de Aprobación')).toBeTruthy()
    expect(getByText('Certification')).toBeTruthy()
    expect(getByText('3')).toBeTruthy()
  })

  it('omits the pass-rate bar for a stage with no rate (null, not 0)', () => {
    const { queryByText } = render(
      <MiniJourney rows={[{ module: 'lms', label: 'LMS', phase: 'cognitive', total_sessions: 40, pass_rate: null }]} />,
    )
    expect(queryByText(/Tasa de Aprobación/)).toBeNull()
  })

  it('shows a placeholder rather than an empty journey for no rows', () => {
    const { getByText } = render(<MiniJourney rows={[]} />)
    expect(getByText('—')).toBeTruthy()
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

  it('links each row to /drilldown/[id] when idField is set', () => {
    const { getByText } = render(
      <MiniTable
        rows={[{ saved_report_id: 501, date: '2026-07-01', usecase: 'Objection Handling' }]}
        idField="saved_report_id"
      />,
    )
    const link = getByText('Ver →').closest('a')
    expect(link?.getAttribute('href')).toBe('/drilldown/501')
  })

  it('never renders the raw id as its own column', () => {
    const { queryByText } = render(
      <MiniTable rows={[{ saved_report_id: 501, usecase: 'Objection Handling' }]} idField="saved_report_id" />,
    )
    expect(queryByText('501')).toBeNull()
  })

  it('omits the link for a row missing the id field', () => {
    const { queryByText } = render(
      <MiniTable rows={[{ usecase: 'Objection Handling' }]} idField="saved_report_id" />,
    )
    expect(queryByText('Ver →')).toBeNull()
  })

  it('adds no link column at all when idField is absent', () => {
    const { queryByText } = render(
      <MiniTable rows={[{ simulator: 'Exkruthera', total_sessions: 2 }]} />,
    )
    expect(queryByText('Ver →')).toBeNull()
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

  it('renders a real donut for a donut widget with real API data', () => {
    const config = {
      company: 'Apotex', slug: 'apotex', title: 'Apotex Analytics', connector: 'pharma_kpi',
      rows: [{ id: 'r1', widgets: [{ id: 'donut_approval', type: 'donut', title: 'Pass / Fail Breakdown' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'donut_approval', ok: true, rows: [{ label: 'Passed', value: 9 }, { label: 'Failed', value: 6 }] }] }

    const { container } = render(<DashboardRenderer config={config} preview={preview} />)

    const pieData = JSON.parse(container.querySelector('[data-testid="pie"]')?.getAttribute('data-points') ?? '[]')
    const byLabel = new Map(pieData.map((d: { label: string; value: number }) => [d.label, d.value]))
    expect(byLabel.get('Passed')).toBe(9)
    expect(byLabel.get('Failed')).toBe(6)
  })

  it('renders the Solution Journey for a journey widget with real per-module data', () => {
    const config = {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'journey', type: 'journey', title: 'Solution Journey' }] }],
      recommendations: [],
    }
    const preview = {
      widgets: [{
        widget_id: 'journey', ok: true,
        rows: [
          { module: 'simulator', label: 'Practice Simulator', phase: 'practice', total_sessions: 144, pass_rate: 36.8 },
          { module: 'certification', label: 'Certification', phase: 'validation', total_sessions: 3, pass_rate: 66.7 },
        ],
      }],
    }

    const { getByText } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(getByText('Practice Simulator')).toBeTruthy()
    expect(getByText('Certification')).toBeTruthy()
    expect(getByText('144')).toBeTruthy()
  })

  it('shows a "no data" note only when the widget genuinely failed', () => {
    const config = {
      company: 'X', slug: 'x', title: 'X', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'w1', type: 'kpi_tile', title: 'Sessions' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'w1', ok: false, error: 'no data: no preview for X' }] }

    const { getByText } = render(<DashboardRenderer config={config} preview={preview} />)

    // Default test language is Spanish (SSR_LANG='es' — see lib/lang-store.ts).
    expect(getByText(/sin datos/)).toBeTruthy()
  })

  it('shows an up arrow with the real delta_pct for a KPI tile that improved', () => {
    const config = {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'tile_total_sessions', type: 'kpi_tile', title: 'Total Sessions' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'tile_total_sessions', ok: true, value: 150, prev_value: 100, delta_pct: 50 }] }

    const { getByText } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(getByText('+50%')).toBeTruthy()
  })

  it('shows the passing-threshold legend under a pass_rate KPI tile', () => {
    const config = {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'tile_pass_rate', type: 'kpi_tile', title: 'Pass Rate', metric_key: 'pass_rate' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'tile_pass_rate', ok: true, value: 62.5, legend: 'Passing threshold: 90 pts' }] }

    const { getByText } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(getByText('Passing threshold: 90 pts')).toBeTruthy()
  })

  it('shows an honest no-data state, no legend, for a tenant with no passing criteria', () => {
    const config = {
      company: 'Sanfer', slug: 'sanfer', title: 'Sanfer Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'tile_pass_rate', type: 'kpi_tile', title: 'Pass Rate', metric_key: 'pass_rate' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'tile_pass_rate', ok: false, value: null, error: 'This tenant has no score-based passing criteria configured' }] }

    const { queryByText } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(queryByText(/Passing threshold/)).toBeNull()
  })

  it('shows a down arrow for a KPI tile that regressed', () => {
    const config = {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'tile_avg_score', type: 'kpi_tile', title: 'Average Score' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'tile_avg_score', ok: true, value: 40, prev_value: 80, delta_pct: -50 }] }

    const { getByText } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(getByText('-50%')).toBeTruthy()
  })

  it('shows a neutral "no comparison" pill when delta_pct is absent (no real baseline)', () => {
    const config = {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'tile_total_users', type: 'kpi_tile', title: 'Total Users' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'tile_total_users', ok: true, value: 12 }] }

    const { getByText, queryByText } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(queryByText(/^\+\d|^-\d/)).toBeNull()
    // Default test language is Spanish (SSR_LANG='es' — see lib/lang-store.ts).
    expect(getByText('sin comparación histórica')).toBeTruthy()
  })

  it('renders the Best Performers leaderboard, ranked, for a table_best_performers widget', () => {
    const config = {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'table_best_performers', type: 'table', title: 'Best Performers' }] }],
      recommendations: [],
    }
    const preview = {
      widgets: [{
        widget_id: 'table_best_performers', ok: true,
        rows: [
          { user_email: 'a@siigo.com', user_name: 'Alice', sessions: 20, avg_score: 91.2, pass_rate: 90 },
          { user_email: 'b@siigo.com', user_name: null, sessions: 15, avg_score: 85, pass_rate: 66.7 },
        ],
      }],
    }

    const { getByText, container } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(getByText('Alice')).toBeTruthy()
    expect(getByText('b@siigo.com')).toBeTruthy()
    expect(getByText('91.20')).toBeTruthy()
    // Matches the hand-built reference dashboards' per-row colored trend
    // indicator on the leaderboard (e.g. a green "↑ 100%" next to the score).
    expect(container.querySelector('.lucide-trending-up')).toBeTruthy()
  })

  it('shows a down-trend indicator on the leaderboard for a below-50% pass rate', () => {
    const config = {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'table_best_performers', type: 'table', title: 'Best Performers' }] }],
      recommendations: [],
    }
    const preview = {
      widgets: [{
        widget_id: 'table_best_performers', ok: true,
        rows: [{ user_email: 'a@siigo.com', user_name: 'Alice', sessions: 5, avg_score: 40, pass_rate: 20 }],
      }],
    }

    const { container } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(container.querySelector('.lucide-trending-down')).toBeTruthy()
  })
})

describe('DashboardRenderer — multi-page navigation', () => {
  // Before this, every AI-generated dashboard was exactly one flat page
  // regardless of how many real pages the tenant's data supported. These
  // tests cover the tab navigation this replaced that with, and confirm the
  // fallback to flat rows for a config built before `pages` existed.
  function multiPageConfig() {
    return {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [{ id: 'row_kpis', widgets: [{ id: 'tile_total_sessions', type: 'kpi_tile', title: 'Total Sessions' }] }],
      pages: [
        { id: 'overview', title: 'Overview', rows: [{ id: 'row_kpis', widgets: [{ id: 'tile_total_sessions', type: 'kpi_tile', title: 'Total Sessions' }] }] },
        { id: 'coach', title: 'Master Coach', rows: [{ id: 'coach_kpis', widgets: [{ id: 'coach_tile_total_sessions', type: 'kpi_tile', title: 'Total Sessions' }] }] },
        { id: 'simulator', title: 'Practice Simulator', rows: [{ id: 'sim_kpis', widgets: [{ id: 'simulator_tile_total_sessions', type: 'kpi_tile', title: 'Total Sessions' }] }] },
      ],
      recommendations: [],
    }
  }
  function multiPagePreview() {
    return {
      widgets: [
        { widget_id: 'tile_total_sessions', ok: true, value: 144 },
        { widget_id: 'coach_tile_total_sessions', ok: true, value: 237 },
        { widget_id: 'simulator_tile_total_sessions', ok: true, value: 535 },
      ],
    }
  }

  it('renders a tab per page and shows the first page by default', () => {
    const { getByText, getAllByRole } = render(<DashboardRenderer config={multiPageConfig()} preview={multiPagePreview()} />)
    const tabs = getAllByRole('tab')
    // Default test language is Spanish (SSR_LANG='es' — see lib/lang-store.ts);
    // page titles are generated-content strings translated at render time.
    expect(tabs.map(t => t.textContent)).toEqual(['Resumen', 'Coach Maestro', 'Simulador de Práctica'])
    // Overview's own value (144) is visible; the other pages' values are not.
    expect(getByText('144')).toBeTruthy()
    expect(() => getByText('237')).toThrow()
  })

  it('switches to the clicked page and shows ONLY that page\'s widgets', () => {
    const { getByText, getAllByRole } = render(<DashboardRenderer config={multiPageConfig()} preview={multiPagePreview()} />)
    fireEvent.click(getAllByRole('tab')[1]) // "Master Coach"
    expect(getByText('237')).toBeTruthy()
    expect(() => getByText('144')).toThrow()
    expect(() => getByText('535')).toThrow()
  })

  it('marks the active tab via aria-selected', () => {
    const { getAllByRole } = render(<DashboardRenderer config={multiPageConfig()} preview={multiPagePreview()} />)
    const tabs = getAllByRole('tab')
    fireEvent.click(tabs[2]) // "Practice Simulator"
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].getAttribute('aria-selected')).toBe('false')
  })

  it('falls back to flat row rendering with no tabs when pages is absent', () => {
    const config = {
      company: 'X', slug: 'x', title: 'X', connector: 'rolplay_app_sql',
      rows: [{ id: 'r1', widgets: [{ id: 'w1', type: 'kpi_tile', title: 'Sessions' }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'w1', ok: true, value: 42 }] }
    const { getByText, queryAllByRole } = render(<DashboardRenderer config={config} preview={preview} />)
    expect(getByText('42')).toBeTruthy()
    expect(queryAllByRole('tab')).toHaveLength(0)
  })

  it('renders no tab bar for a single-page config (nothing to switch between)', () => {
    const config = {
      company: 'X', slug: 'x', title: 'X', connector: 'rolplay_app_sql',
      rows: [],
      pages: [{ id: 'overview', title: 'Overview', rows: [{ id: 'r1', widgets: [{ id: 'w1', type: 'kpi_tile', title: 'Sessions' }] }] }],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'w1', ok: true, value: 7 }] }
    const { getByText, queryAllByRole } = render(<DashboardRenderer config={config} preview={preview} />)
    expect(getByText('7')).toBeTruthy()
    expect(queryAllByRole('tab')).toHaveLength(0)
  })
})

describe('DashboardRenderer — mandatory sections with no data', () => {
  it('shows an honest empty state for a mandatory page instead of silently omitting it', () => {
    const config = {
      company: 'Salinas', slug: 'salinas', title: 'Salinas Analytics', connector: 'rolplay_app_sql',
      rows: [],
      pages: [
        { id: 'overview', title: 'Overview', rows: [{ id: 'row_kpis', widgets: [{ id: 'tile_total_sessions', type: 'kpi_tile', title: 'Total Sessions' }] }] },
        { id: 'lms', title: 'LMS', mandatory: true, rows: [{ id: 'lms_empty', title: 'LMS', widgets: [] }] },
      ],
      recommendations: [],
    }
    const preview = { widgets: [{ widget_id: 'tile_total_sessions', ok: true, value: 144 }] }
    const { getByText, getAllByRole } = render(<DashboardRenderer config={config} preview={preview} />)

    expect(getAllByRole('tab').map(t => t.textContent)).toEqual(['Resumen', 'LMS'])
    fireEvent.click(getByText('LMS'))
    // Default test language is Spanish (SSR_LANG='es' — see lib/lang-store.ts).
    expect(getByText('Aún no hay datos disponibles')).toBeTruthy()
    expect(getByText(/solicitada pero no tiene datos/)).toBeTruthy()
  })
})

describe('ReportsTable', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`,
    rep: i % 3 === 0 ? 'alice@siigo.com' : 'bob@siigo.com',
    result: i % 2 === 0 ? 'Passed' : 'Failed',
  }))

  it('shows a placeholder for no rows', () => {
    const { container } = render(<ReportsTable rows={[]} searchable exportable filenamePrefix="reports" />)
    expect(container.querySelector('table')).toBeNull()
  })

  it('translates the "result" column\'s Passed/Failed data values, not just the column header', () => {
    // Regression: 'Passed'/'Failed' are SQL CASE-expression literals baked
    // into the row data itself (ai-service's preview_fetch.py), not app
    // chrome -- the column HEADER translating was not enough, the cell
    // VALUES were still raw English even with the toggle on Spanish.
    render(<ReportsTable rows={rows} searchable exportable filenamePrefix="reports" />)
    expect(screen.queryByText('Passed')).toBeNull()
    expect(screen.queryByText('Failed')).toBeNull()
    expect(screen.getAllByText('Aprobado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Reprobado').length).toBeGreaterThan(0)
  })

  it('paginates real rows (25 per page)', () => {
    render(<ReportsTable rows={rows} searchable exportable filenamePrefix="reports" />)
    expect(screen.getAllByRole('row')).toHaveLength(1 + 25) // header + 25 body rows
    expect(screen.getByText('Página 1 de 2')).toBeTruthy()
  })

  it('advances to the next page', () => {
    render(<ReportsTable rows={rows} searchable exportable filenamePrefix="reports" />)
    fireEvent.click(screen.getByText('Siguiente'))
    expect(screen.getByText('Página 2 de 2')).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(1 + 5) // remaining 5 rows
  })

  it('filters rows via the search box, across every column', () => {
    render(<ReportsTable rows={rows} searchable exportable filenamePrefix="reports" />)
    fireEvent.change(screen.getByPlaceholderText('Buscar…'), { target: { value: 'alice' } })
    // Default test language is Spanish (SSR_LANG='es' — see lib/lang-store.ts).
    expect(screen.getByText('10 filas')).toBeTruthy() // 30/3 rows are alice's
  })

  it('omits the search box when searchable is false', () => {
    render(<ReportsTable rows={rows} searchable={false} exportable filenamePrefix="reports" />)
    expect(screen.queryByPlaceholderText('Buscar…')).toBeNull()
  })

  it('omits the export button when exportable is false', () => {
    render(<ReportsTable rows={rows} searchable exportable={false} filenamePrefix="reports" />)
    expect(screen.queryByText('Export CSV')).toBeNull()
  })
})

describe('DashboardRenderer — AI Insights', () => {
  const baseConfig = {
    company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
    rows: [], recommendations: [],
  }

  it('shows insight sentences when present, each as its own alert-style card', () => {
    const config = { ...baseConfig, insights: ['Reps completed 772 sessions with an average score of 61.'] }
    const { getByText, container } = render(<DashboardRenderer config={config} preview={{ widgets: [] }} />)
    expect(getByText('Reps completed 772 sessions with an average score of 61.')).toBeTruthy()
    // Matches the hand-built reference dashboards' "Insights IA" warning-icon
    // card treatment, not a single shared box with a bulleted list.
    expect(container.querySelector('.lucide-triangle-alert')).toBeTruthy()
  })

  it('renders nothing when insights is empty or absent', () => {
    const { container } = render(<DashboardRenderer config={baseConfig} preview={{ widgets: [] }} />)
    expect(container.querySelector('.lucide-triangle-alert')).toBeNull()
  })

  it('still shows insights on a multi-page config, above the tab bar', () => {
    const config = {
      ...baseConfig,
      pages: [{ id: 'overview', title: 'Overview', rows: [] }, { id: 'reports', title: 'Reports', rows: [] }],
      insights: ['A real grounded insight.'],
    }
    const { getByText } = render(<DashboardRenderer config={config} preview={{ widgets: [] }} />)
    expect(getByText('A real grounded insight.')).toBeTruthy()
    expect(getByText('Resumen')).toBeTruthy()
  })
})

describe('Language consistency — EN/ES round trip on real generated-content shapes', () => {
  // Mirrors an actual AI-service-generated config verbatim: literal page/row/
  // widget titles and business_question strings copied from
  // ai-service/app/agents/schema_discovery.py and dashboard_planning.py, not
  // invented for this test -- if any of these ever fall out of sync with the
  // real Python literals, lib/generated-content-i18n.ts's dictionary (and
  // this test) both need updating together.
  function realisticConfig() {
    return {
      company: 'Siigo', slug: 'siigo', title: 'Siigo Analytics', connector: 'rolplay_app_sql',
      rows: [],
      pages: [
        {
          id: 'overview', title: 'Overview',
          rows: [
            {
              id: 'row_kpis', title: 'Overview',
              widgets: [
                { id: 'tile_total_sessions', type: 'kpi_tile', title: 'Total Sessions', metric_key: 'total_sessions' },
                { id: 'tile_avg_score', type: 'kpi_tile', title: 'Average Score', metric_key: 'avg_score' },
                { id: 'tile_pass_rate', type: 'kpi_tile', title: 'Pass Rate', metric_key: 'pass_rate' },
              ],
            },
            {
              id: 'row_charts', title: 'Analytics',
              widgets: [
                { id: 'chart_trend', type: 'line_chart', title: 'Score Trend' },
                {
                  id: 'table_breakdown', type: 'table', title: 'By Simulator — detail',
                  business_question: 'Which practice scenarios are reps using, and how do they perform on each?',
                },
              ],
            },
          ],
        },
        {
          id: 'kpis', title: 'KPIs',
          rows: [{
            id: 'kpis_group1', title: 'Adoption, Efficiency & Readiness',
            widgets: [{ id: 'tile_cesar_activation_rate', type: 'kpi_tile', title: 'Activation Rate' }],
          }],
        },
        { id: 'reports', title: 'Reports', rows: [] },
      ],
      recommendations: [],
    }
  }

  function realisticPreview() {
    return {
      widgets: [
        { widget_id: 'tile_total_sessions', ok: true, value: 154 },
        { widget_id: 'tile_avg_score', ok: true, value: 46.25 },
        { widget_id: 'tile_pass_rate', ok: true, value: 12.3 },
        { widget_id: 'tile_cesar_activation_rate', ok: true, value: 88.1 },
        {
          widget_id: 'table_breakdown', ok: true,
          rows: [{ simulator: 'Discovery Call', total_sessions: 12, avg_score: 55.2 }],
        },
      ],
    }
  }

  afterEach(() => {
    useLangStore.getState().setLang('es') // restore the suite-wide default
  })

  it('renders every generated string in English with zero Spanish leakage', () => {
    useLangStore.getState().setLang('en')
    const { getByText, getAllByRole, queryByText } = render(
      <DashboardRenderer config={realisticConfig()} preview={realisticPreview()} />,
    )
    expect(getAllByRole('tab').map(t => t.textContent)).toEqual(['Overview', 'KPIs', 'Reports'])
    expect(getByText('Total Sessions')).toBeTruthy()
    expect(getByText('Average Score')).toBeTruthy()
    expect(getByText('Pass Rate')).toBeTruthy()
    // No Spanish translation of any of these strings should appear.
    expect(queryByText('Resumen')).toBeNull()
    expect(queryByText('Sesiones Totales')).toBeNull()
    expect(queryByText('Puntuación Promedio')).toBeNull()
    expect(queryByText('Tasa de Aprobación')).toBeNull()
  })

  it('renders every generated string in Spanish with zero English leakage', () => {
    useLangStore.getState().setLang('es')
    const { getByText, getAllByText, getAllByRole, queryByText, container } = render(
      <DashboardRenderer config={realisticConfig()} preview={realisticPreview()} />,
    )
    expect(getAllByRole('tab').map(t => t.textContent)).toEqual(['Resumen', 'KPIs', 'Reportes'])
    fireEvent.click(getAllByRole('tab')[0])
    // "Sesiones Totales" appears twice on purpose: the KPI tile title AND the
    // breakdown table's translated "total_sessions" column header.
    expect(getAllByText('Sesiones Totales').length).toBeGreaterThanOrEqual(2)
    expect(getByText('Puntuación Promedio')).toBeTruthy()
    expect(getByText('Tasa de Aprobación')).toBeTruthy()
    expect(getByText('Tendencia de Puntuación')).toBeTruthy()
    expect(getByText('Por Simulador — detalle')).toBeTruthy()
    expect(getByText('¿Qué escenarios de práctica usan los representantes y cómo se desempeñan en cada uno?')).toBeTruthy()
    // No English original of any of these strings should survive.
    expect(queryByText('Overview')).toBeNull()
    expect(queryByText('Total Sessions')).toBeNull()
    expect(queryByText('Average Score')).toBeNull()
    expect(queryByText('Pass Rate')).toBeNull()
    expect(queryByText('Score Trend')).toBeNull()
    expect(queryByText('Reports')).toBeNull()
    // Table column headers (from live per-simulator breakdown rows) must
    // also translate, not just widget/page chrome.
    fireEvent.click(getAllByRole('tab')[0])
    expect(container.textContent).not.toMatch(/\btotal_sessions\b/)
  })

  it('switching EN -> ES -> EN never leaves stale text from the previous language', () => {
    useLangStore.getState().setLang('en')
    const { rerender, queryByText, getByText } = render(
      <DashboardRenderer config={realisticConfig()} preview={realisticPreview()} />,
    )
    expect(getByText('Average Score')).toBeTruthy()

    useLangStore.getState().setLang('es')
    rerender(<DashboardRenderer config={realisticConfig()} preview={realisticPreview()} />)
    expect(queryByText('Average Score')).toBeNull()
    expect(getByText('Puntuación Promedio')).toBeTruthy()

    useLangStore.getState().setLang('en')
    rerender(<DashboardRenderer config={realisticConfig()} preview={realisticPreview()} />)
    expect(queryByText('Puntuación Promedio')).toBeNull()
    expect(getByText('Average Score')).toBeTruthy()
  })

  it('an unmapped/unknown generated string renders as-is in either language, never blank', () => {
    // A page title only ever renders as a tab label when there's more than
    // one page (DashboardRenderer.tsx: `pages.length > 1 && (...)`) -- a
    // lone page's title has nowhere to display at all, by the existing,
    // unrelated design of this component.
    useLangStore.getState().setLang('es')
    const config = {
      ...realisticConfig(),
      pages: [
        { id: 'x', title: 'Some Brand New AI-Invented Page Title', rows: [] },
        { id: 'overview', title: 'Overview', rows: [] },
      ],
    }
    const { getByText } = render(<DashboardRenderer config={config} preview={{ widgets: [] }} />)
    expect(getByText('Some Brand New AI-Invented Page Title')).toBeTruthy()
    expect(getByText('Resumen')).toBeTruthy()
  })
})
