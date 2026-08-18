/**
 * Regression: the Dashboard Builder page renders its own <header> instead of
 * the shared DashboardHeader every other page uses, and had NO language-toggle
 * affordance at all. Every string on the page correctly went through useT()
 * (it always respected whatever language the store was already in), but an
 * admin landing directly on /dashboard-builder had no way to SWITCH it without
 * navigating to another page first and coming back.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }))
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ user: { id: 1, email: 'admin@test.com', role: 'admin' }, isLoading: false }),
}))
vi.mock('@/components/DashboardRenderer', () => ({
  DashboardRenderer: () => null,
  humanizeConnector: (k: string) => k,
}))

let mockLang: 'en' | 'es' = 'es'
const mockToggle = vi.fn(() => { mockLang = mockLang === 'en' ? 'es' : 'en' })

vi.mock('@/lib/lang-store', () => ({
  useLangStore: () => ({ lang: mockLang, toggle: mockToggle }),
  useT: () => (mockLang === 'en'
    ? {
        builderTitle: 'Dashboard Builder', builderSubtitlePre: 'Generate a ',
        builderGenerateWord: 'dashboard', builderSubtitlePost: ' for a client.',
        builderServicesLabel: 'Contracted services', builderCompanyLabel: 'Company',
        builderCompanyPlaceholder: 'e.g. Acme Pharma', builderDomainLabel: 'Domain',
        builderDomainPlaceholder: 'e.g. acme.com', builderGenerateButton: 'Generate',
        builderLoading: 'Loading…', builderAccessDenied: 'Access denied',
        builderAccessDeniedMsg: 'You do not have access.', builderPleaseLogin: ' Please log in.',
        builderBackToDashboard: 'Back to dashboard', builderGoToLogin: 'Go to login',
        builderRequestTemplate: 'Generate a dashboard for {company}', builderDefaultCompany: 'this company',
        builderThisCompany: 'this company', builderEmptyMsgPre: 'No dashboard for ', builderEmptyMsgPost: ' yet.',
        builderStepPlan: 'Plan', builderStepLocate: 'Locate',
      }
    : {
        builderTitle: 'Generador de Dashboards', builderSubtitlePre: 'Genera un ',
        builderGenerateWord: 'dashboard', builderSubtitlePost: ' para un cliente.',
        builderServicesLabel: 'Servicios contratados', builderCompanyLabel: 'Empresa',
        builderCompanyPlaceholder: 'ej. Acme Pharma', builderDomainLabel: 'Dominio',
        builderDomainPlaceholder: 'ej. acme.com', builderGenerateButton: 'Generar',
        builderLoading: 'Cargando…', builderAccessDenied: 'Acceso denegado',
        builderAccessDeniedMsg: 'No tienes acceso.', builderPleaseLogin: ' Por favor inicia sesión.',
        builderBackToDashboard: 'Volver al panel', builderGoToLogin: 'Ir a iniciar sesión',
        builderRequestTemplate: 'Genera un dashboard para {company}', builderDefaultCompany: 'esta empresa',
        builderThisCompany: 'esta empresa', builderEmptyMsgPre: 'Sin dashboard para ', builderEmptyMsgPost: ' todavía.',
        builderStepPlan: 'Plan', builderStepLocate: 'Localizar',
      }),
}))

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [] }))
vi.stubGlobal('fetch', fetchMock)

import DashboardBuilderPage from '../page'

beforeEach(() => {
  mockLang = 'es'
  mockToggle.mockClear()
  fetchMock.mockClear()
})

describe('Dashboard Builder page — language toggle', () => {
  it('renders a language toggle button (previously entirely absent)', () => {
    render(<DashboardBuilderPage />)
    expect(screen.getByLabelText('Toggle language')).toBeTruthy()
  })

  it('shows Spanish content by default and the button to switch to English', () => {
    render(<DashboardBuilderPage />)
    expect(screen.getByText('Generador de Dashboards')).toBeTruthy()
    expect(screen.getByLabelText('Toggle language').textContent).toBe('EN')
  })

  it('clicking the toggle calls the shared language store toggle, same as every other page', () => {
    render(<DashboardBuilderPage />)
    fireEvent.click(screen.getByLabelText('Toggle language'))
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('renders English content and the button to switch back to Spanish once toggled', () => {
    mockLang = 'en'
    render(<DashboardBuilderPage />)
    expect(screen.getByText('Dashboard Builder')).toBeTruthy()
    expect(screen.getByLabelText('Toggle language').textContent).toBe('ES')
  })
})
