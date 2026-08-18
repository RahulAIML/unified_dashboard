import { describe, expect, it, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { DashboardFooter } from '../DashboardFooter'
import { useLangStore } from '@/lib/lang-store'

describe('DashboardFooter', () => {
  beforeEach(() => useLangStore.setState({ lang: 'en' }))

  it('uses the shared locale and updates immediately when it changes', () => {
    render(<DashboardFooter />)
    expect(screen.getByTestId('dashboard-confidentiality')).toHaveTextContent(
      'Confidential — For exclusive use by the Innovation Area',
    )

    act(() => useLangStore.getState().setLang('es'))
    expect(screen.getByTestId('dashboard-confidentiality')).toHaveTextContent(
      'Confidencial — Uso exclusivo del Área de Innovación',
    )
  })
})
