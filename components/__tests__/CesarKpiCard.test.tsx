import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CesarKpiCard, CesarKpiValue } from '../CesarKpiCard'

describe('CesarKpiCard', () => {
  it('renders title, description, formula, and the footer interpretation', () => {
    render(
      <CesarKpiCard title="Activation Rate" description="Some description" formula="Formula: A / B x 100" footer="Some footer sentence.">
        <div>body</div>
      </CesarKpiCard>,
    )
    expect(screen.getByText('Activation Rate')).toBeTruthy()
    expect(screen.getByText('Some description')).toBeTruthy()
    expect(screen.getByText('Formula: A / B x 100')).toBeTruthy()
    expect(screen.getByText('Some footer sentence.')).toBeTruthy()
    expect(screen.getByText('body')).toBeTruthy()
  })
})

describe('CesarKpiValue', () => {
  it('shows an em dash, not a fabricated number, when there is no data', () => {
    render(<CesarKpiValue value={null} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('shows an upward delta badge when the metric improved vs. the previous period', () => {
    render(<CesarKpiValue value={85} prevValue={80} deltaLabel="vs. previous period" />)
    expect(screen.getByText('85')).toBeTruthy()
    expect(screen.getByText('+5%')).toBeTruthy()
    expect(screen.getByText('vs. previous period')).toBeTruthy()
  })

  it('shows a downward delta badge when the metric regressed vs. the previous period', () => {
    render(<CesarKpiValue value={60} prevValue={70} deltaLabel="vs. previous period" />)
    expect(screen.getByText('-10%')).toBeTruthy()
  })

  it('renders no delta badge when there is no previous-period value to compare', () => {
    render(<CesarKpiValue value={85} prevValue={null} />)
    expect(screen.queryByText(/^[+-]/)).toBeNull()
  })

  it('shows an "on track" badge and a filled goal bar once the value reaches the goal', () => {
    render(<CesarKpiValue value={82} goal={80} goalLabel="Goal: >= 80%" />)
    expect(screen.getByText('On track')).toBeTruthy()
    expect(screen.getByText('Goal: >= 80%')).toBeTruthy()
  })

  it('shows a "below goal" badge when the value has not reached the goal', () => {
    render(<CesarKpiValue value={65} goal={80} />)
    expect(screen.getByText('Below goal')).toBeTruthy()
  })

  it('never shows a goal bar when no goal is passed -- most KPIs on this page have no spec-sourced target', () => {
    render(<CesarKpiValue value={65} />)
    expect(screen.queryByText('On track')).toBeNull()
    expect(screen.queryByText('Below goal')).toBeNull()
  })
})
