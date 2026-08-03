/**
 * lib/cache.ts — Redis-backed cache with an in-process fallback (ROADMAP
 * Phase 6's Redis blocker). These tests exercise the in-process fallback
 * path specifically (no REDIS_URL configured in the test env, matching a
 * real dev/CI environment) -- the module must behave identically to a
 * plain TTL cache in that case, which is what lib/lms-learnworlds.ts relied
 * on before this module existed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('cache (in-process fallback, no REDIS_URL)', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.REDIS_URL
  })

  it('returns null for a key that was never set', async () => {
    const { cacheGet } = await import('../cache')
    expect(await cacheGet('nope')).toBeNull()
  })

  it('returns the value that was set, before it expires', async () => {
    const { cacheGet, cacheSet } = await import('../cache')
    await cacheSet('k1', { a: 1 }, 60)
    expect(await cacheGet('k1')).toEqual({ a: 1 })
  })

  it('expires a value after its TTL', async () => {
    vi.useFakeTimers()
    try {
      const { cacheGet, cacheSet } = await import('../cache')
      await cacheSet('k2', 'value', 1)
      expect(await cacheGet('k2')).toBe('value')
      vi.advanceTimersByTime(1_500)
      expect(await cacheGet('k2')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('getOrSetCache calls fn only once for a fresh cache, reusing the cached value after', async () => {
    const { getOrSetCache } = await import('../cache')
    let calls = 0
    const fn = async () => { calls++; return 'computed' }

    const first = await getOrSetCache('k3', 60, fn)
    const second = await getOrSetCache('k3', 60, fn)

    expect(first).toBe('computed')
    expect(second).toBe('computed')
    expect(calls).toBe(1)
  })

  it('getOrSetCache recomputes once the TTL has elapsed', async () => {
    vi.useFakeTimers()
    try {
      const { getOrSetCache } = await import('../cache')
      let calls = 0
      const fn = async () => { calls++; return `computed-${calls}` }

      const first = await getOrSetCache('k4', 1, fn)
      vi.advanceTimersByTime(1_500)
      const second = await getOrSetCache('k4', 1, fn)

      expect(first).toBe('computed-1')
      expect(second).toBe('computed-2')
      expect(calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('different keys never collide', async () => {
    const { cacheSet, cacheGet } = await import('../cache')
    await cacheSet('a', 1, 60)
    await cacheSet('b', 2, 60)
    expect(await cacheGet('a')).toBe(1)
    expect(await cacheGet('b')).toBe(2)
  })
})
