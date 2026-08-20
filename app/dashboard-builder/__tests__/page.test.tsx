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
        builderSessionsUsers: 'sessions', builderUsersWord: 'users', builderNoActivityYet: 'no activity yet',
        builderNewBadge: 'New', builderNoMatchingCompanies: 'No matching companies.',
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
        builderSessionsUsers: 'sesiones', builderUsersWord: 'usuarios', builderNoActivityYet: 'sin actividad todavía',
        builderNewBadge: 'Nuevo', builderNoMatchingCompanies: 'Sin coincidencias.',
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

describe('Dashboard Builder page — company picker', () => {
  /**
   * Regression: the picker only ever queried rolplay_app_sql's r_client
   * table, so a client invited through the self-service admin wizard
   * (/admin/tenants -> pharma_tenants) never appeared here at all -- a
   * manager who had just invited a real client (reported live: Heineken)
   * had to type the name by hand, defeating the point of the picker.
   * app/api/ai/known-companies/route.ts now merges both sources; this
   * covers the frontend's rendering of that merged list, including the red
   * "Nuevo" badge for a recently-invited (isNew) entry.
   */
  const knownCompanies = [
    { id: 'rolplay_app_sql:29', name: 'Siigo', sessions: 154, users: 73, source: 'rolplay_app_sql', isNew: false },
    { id: 'pharma:heineken', name: 'Heineken', sessions: 0, users: 0, source: 'pharma', isNew: true },
  ]

  beforeEach(() => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => knownCompanies }))
  })

  it('shows a newly-invited pharma tenant in the dropdown with a "Nuevo" badge', async () => {
    render(<DashboardBuilderPage />)
    const input = await screen.findByPlaceholderText('ej. Acme Pharma')
    fireEvent.focus(input)
    expect(await screen.findByText('Heineken')).toBeTruthy()
    expect(screen.getByText('Nuevo')).toBeTruthy()
  })

  it('does not show the "Nuevo" badge on a real rolplay_app_sql client', async () => {
    render(<DashboardBuilderPage />)
    const input = await screen.findByPlaceholderText('ej. Acme Pharma')
    fireEvent.focus(input)
    const siigoRow = (await screen.findByText('Siigo')).closest('button')
    expect(siigoRow?.textContent).not.toContain('Nuevo')
  })

  it('clicking a dropdown row fills the company field and closes the dropdown', async () => {
    render(<DashboardBuilderPage />)
    const input = await screen.findByPlaceholderText('ej. Acme Pharma') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.click(await screen.findByText('Heineken'))
    expect(input.value).toBe('Heineken')
    expect(screen.queryByText('sin actividad todavía')).toBeNull()
  })

  it('filters the dropdown as the manager types', async () => {
    render(<DashboardBuilderPage />)
    const input = await screen.findByPlaceholderText('ej. Acme Pharma')
    fireEvent.focus(input)
    await screen.findByText('Heineken')
    fireEvent.change(input, { target: { value: 'sii' } })
    expect(screen.getByText('Siigo')).toBeTruthy()
    expect(screen.queryByText('Heineken')).toBeNull()
  })
})
