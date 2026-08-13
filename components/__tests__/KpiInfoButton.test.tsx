import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { KpiInfoButton } from '../KpiInfoButton'

/** Simulates a device that does/doesn't report hover support via matchMedia
 *  -- KpiInfoButton only wires mouseenter/mouseleave when this is true. */
function mockHoverSupport(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches }))
}

afterEach(() => vi.unstubAllGlobals())

describe('KpiInfoButton', () => {
  it('does not show the definition until interacted with', () => {
    mockHoverSupport(true)
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('shows the definition on hover, on a device that reports hover support', async () => {
    mockHoverSupport(true)
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    fireEvent.mouseEnter(await screen.findByRole('button'))
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
  })

  it('hides the definition when the mouse leaves, on a hover-capable device', async () => {
    mockHoverSupport(true)
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    const button = await screen.findByRole('button')
    fireEvent.mouseEnter(button)
    fireEvent.mouseLeave(button)
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('never attaches hover handlers on a touch device (no hover support)', async () => {
    // Regression: wiring mouseenter unconditionally meant a tap fired a
    // synthetic mouseenter (open) immediately followed by the click
    // handler's toggle (close) -- the popover flashed and vanished instead
    // of opening. Hovering must be a no-op when hover isn't supported.
    mockHoverSupport(false)
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    fireEvent.mouseEnter(await screen.findByRole('button'))
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('toggles open on click, for touch devices with no hover', async () => {
    mockHoverSupport(false)
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    const button = await screen.findByRole('button')
    fireEvent.click(button)
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('closes on an outside click', async () => {
    mockHoverSupport(false)
    render(
      <div>
        <KpiInfoButton definition="Pass rate: score >= 70." />
        <button>elsewhere</button>
      </div>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /what does this metric mean/i }))
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('closes on Escape', async () => {
    mockHoverSupport(false)
    render(<KpiInfoButton definition="Pass rate: score >= 70." />)
    fireEvent.click(await screen.findByRole('button'))
    expect(screen.getByText('Pass rate: score >= 70.')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Pass rate: score >= 70.')).toBeNull()
  })

  it('renders the popover outside the card via a portal, so an ancestor with overflow-hidden cannot clip it', async () => {
    mockHoverSupport(false)
    const { container } = render(
      <div style={{ overflow: 'hidden', height: 10 }} data-testid="clipping-card">
        <KpiInfoButton definition="Pass rate: score >= 70." />
      </div>,
    )
    fireEvent.click(await screen.findByRole('button'))
    const popover = screen.getByRole('tooltip')
    const clippingCard = container.querySelector('[data-testid="clipping-card"]')
    expect(clippingCard?.contains(popover)).toBe(false)
    expect(document.body.contains(popover)).toBe(true)
  })
})
