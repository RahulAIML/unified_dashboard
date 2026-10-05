/**
 * Regression: a route can deliberately signal "this feature isn't set up for
 * this organization" as { success: false, data: { notConfigured: true,
 * message: "<raw English backend text>" } } with HTTP 200 -- specifically so
 * it's never treated as a real failure (see /api/second-brain/profile).
 *
 * Before this fix, useApi's generic unwrap logic saw success:false and threw
 * regardless, turning that soft signal into a hard error whose raw,
 * untranslated message then got concatenated onto a translated Spanish
 * "Error al cargar los datos:" banner on /journey -- a mixed-language error
 * banner for what should have been a normal empty state.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useApi } from '../useApi'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

describe('useApi — notConfigured is not an error', () => {
  it('resolves to data:null, error:null instead of throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        data: { message: "Second Brain isn't set up for your organization yet.", notConfigured: true },
        meta: {},
      }),
    })

    const { result } = renderHook(() => useApi('/api/second-brain/profile'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.data).toBeNull()
  })

  it('still throws for an ordinary success:false failure (no notConfigured)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, data: { message: 'Upstream timed out' }, meta: {} }),
    })

    const { result } = renderHook(() => useApi('/api/dashboard/overview'))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('Upstream timed out')
    expect(result.current.data).toBeNull()
  })
})
