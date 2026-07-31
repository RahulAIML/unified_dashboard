/**
 * Found live in production, 2026-07-31: saving a color/preset/logo silently
 * failed with no visible feedback whenever /api/branding rejected the write
 * (e.g. "Auth database schema not initialised" — branding_settings didn't
 * exist yet). The page just reverted to "unsaved changes" with zero
 * explanation, indistinguishable from the app simply ignoring the click.
 *
 * These tests pin that a failed save now surfaces the server's real error
 * message instead of failing silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@/lib/lang-store', () => ({
  useT: () => ({
    settingsTitle: 'Settings', settingsBrandingSub: 'Customize', settingsPlatformName: 'Platform Name',
    settingsPlatformNameDesc: 'desc', settingsPlatformNameHint: 'hint', settingsLogo: 'Logo',
    settingsLogoHint: 'hint', settingsLogoNoLogo: 'No logo', settingsLogoRemove: 'Remove logo',
    settingsThemePresets: 'Presets', settingsAdvColors: 'Advanced', settingsAdvColorsSub: 'sub',
    settingsPrimaryColor: 'Primary', settingsPrimaryDesc: 'desc', settingsSecondaryColor: 'Secondary',
    settingsSecondaryDesc: 'desc', settingsAccentColor: 'Accent', settingsAccentDesc: 'desc',
    settingsCopy: 'Copy', settingsLivePreview: 'Preview', settingsPrimaryBtn: 'Button',
    settingsKpiLabel: 'KPI', settingsKpiExample: 'example', settingsResetDefault: 'Reset',
    settingsUnsaved: 'Unsaved changes', settingsSaved: 'Saved', settingsSaving: 'Saving...',
    settingsSaveChanges: 'Save changes', settingsUploadLogo: 'Upload logo', settingsUploading: 'Uploading...',
  }),
}))
vi.mock('@/lib/hooks/usePlatformName', () => ({
  usePlatformName: () => ({ platformName: 'Rolplay Analytics', setPlatformName: vi.fn(), isLoaded: true }),
}))
vi.mock('@/components/DashboardHeader', () => ({
  DashboardHeader: ({ title }: { title: string }) => <div>{title}</div>,
}))

const saveBranding = vi.fn()
vi.mock('@/lib/hooks/useClientBrand', () => ({
  useClientBrand: () => ({
    isLoading: false,
    logo: null,
    primaryColor: '#DC2626',
    secondaryColor: '#1F2937',
    accentColor: '#14B8A6',
    saveBranding,
  }),
}))

async function loadPage() {
  vi.resetModules()
  return (await import('../page')).default
}

beforeEach(() => {
  saveBranding.mockReset()
})

function makeDirty() {
  // The save button is disabled until something actually changed — type a
  // new platform name so "Save changes" becomes clickable.
  const input = screen.getByPlaceholderText('Platform Name')
  fireEvent.change(input, { target: { value: 'QA Test Alpha' } })
}

describe('SettingsPage — save failure feedback', () => {
  it('shows the server error message when a save fails, instead of failing silently', async () => {
    saveBranding.mockRejectedValue(new Error('Auth database schema not initialised. Call GET /api/auth/setup to create tables.'))
    const SettingsPage = await loadPage()
    render(<SettingsPage />)

    await waitFor(() => makeDirty())
    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Auth database schema not initialised/)
    })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('clears the error once the save succeeds', async () => {
    saveBranding.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined)
    const SettingsPage = await loadPage()
    render(<SettingsPage />)

    await waitFor(() => makeDirty())
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'))

    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
