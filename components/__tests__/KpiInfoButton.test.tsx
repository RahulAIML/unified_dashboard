import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KpiInfoButton } from '../KpiInfoButton'

describe('KpiInfoButton', () => {
  it('does not show the definition until interacted with', () => {
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('shows the definition on hover', () => {
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    fireEvent.mouseEnter(screen.getByRole('button'))
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
  })

  it('hides the definition when the mouse leaves', () => {
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    const button = screen.getByRole('button')
    fireEvent.mouseEnter(button)
    fireEvent.mouseLeave(button)
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('toggles open on click, for touch devices with no hover', () => {
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('closes on an outside click', () => {
    render(
      <div>
        <KpiInfoButton definition="Pass rate: score >= 70." />
        <button>elsewhere</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: /what does this metric mean/i }))
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('closes on Escape', () => {
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })
})
