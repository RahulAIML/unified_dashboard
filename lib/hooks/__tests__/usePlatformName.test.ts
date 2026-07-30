/**
 * Regression test for the platform-name leak.
 *
 * The bug: the localStorage key had no user suffix at all, so it lived in the
 * BROWSER rather than the account. Any second user signing in on the same
 * browser (exactly how manual multi-account testing works) saw — and
 * overwrote — the first user's custom platform name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePlatformName } from '../usePlatformName'

const mockUser = vi.fn()
vi.mock('@/components/AuthProvider', () => ({
  useAuthContext: () => ({ user: mockUser() }),
}))

beforeEach(() => {
  window.localStorage.clear()
  mockUser.mockReset()
})

describe('usePlatformName — per-user isolation', () => {
  it("does not leak user A's saved name into user B's session", async () => {
    mockUser.mockReturnValue({ id: 1 })
    const a = renderHook(() => usePlatformName())
    await waitFor(() => expect(a.result.current.isLoaded).toBe(true))

    act(() => a.result.current.setPlatformName('Acme Analytics'))
    expect(a.result.current.platformName).toBe('Acme Analytics')

    // Simulate user B signing in on the SAME browser.
    mockUser.mockReturnValue({ id: 2 })
    const b = renderHook(() => usePlatformName())
    await waitFor(() => expect(b.result.current.isLoaded).toBe(true))

    // This is the bug: previously both hooks read the same unscoped key.
    expect(b.result.current.platformName).not.toBe('Acme Analytics')
    expect(b.result.current.platformName).toBe('Rolplay Analytics')
  })

  it('persists independently under two different user ids', async () => {
    mockUser.mockReturnValue({ id: 10 })
    const a = renderHook(() => usePlatformName())
    await waitFor(() => expect(a.result.current.isLoaded).toBe(true))
    act(() => a.result.current.setPlatformName('Org Ten'))

    mockUser.mockReturnValue({ id: 20 })
    const b = renderHook(() => usePlatformName())
    await waitFor(() => expect(b.result.current.isLoaded).toBe(true))
    act(() => b.result.current.setPlatformName('Org Twenty'))

    expect(window.localStorage.getItem('rp-platform-name:10')).toBe('Org Ten')
    expect(window.localStorage.getItem('rp-platform-name:20')).toBe('Org Twenty')
  })

  it('re-reads the correct name when the SAME user re-mounts (e.g. navigation)', async () => {
    mockUser.mockReturnValue({ id: 5 })
    const first = renderHook(() => usePlatformName())
    await waitFor(() => expect(first.result.current.isLoaded).toBe(true))
    act(() => first.result.current.setPlatformName('Persisted Name'))

    const second = renderHook(() => usePlatformName())
    await waitFor(() => expect(second.result.current.isLoaded).toBe(true))

    expect(second.result.current.platformName).toBe('Persisted Name')
  })

  it('does not read localStorage before auth has resolved (no stale flash)', () => {
    mockUser.mockReturnValue(null)
    const { result } = renderHook(() => usePlatformName())

    // Auth unresolved — must stay in the un-loaded state, not guess.
    expect(result.current.isLoaded).toBe(false)
  })

  it('clearing the name resets to the default for that user only', async () => {
    mockUser.mockReturnValue({ id: 1 })
    const { result } = renderHook(() => usePlatformName())
    await waitFor(() => expect(result.current.isLoaded).toBe(true))

    act(() => result.current.setPlatformName('Custom'))
    expect(result.current.platformName).toBe('Custom')

    act(() => result.current.setPlatformName(''))
    expect(result.current.platformName).toBe('Rolplay Analytics')
    expect(window.localStorage.getItem('rp-platform-name:1')).toBeNull()
  })
})
