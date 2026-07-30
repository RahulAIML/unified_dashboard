import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, clientKey, rateLimitHeaders, __resetRateLimits } from '../rate-limit'

beforeEach(() => __resetRateLimits())

describe('rateLimit', () => {
  it('allows requests up to the limit and rejects the next one', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit('k', 3, 60_000).ok).toBe(true)
    }
    expect(rateLimit('k', 3, 60_000).ok).toBe(false)
  })

  it('reports remaining budget accurately', () => {
    expect(rateLimit('k', 3, 60_000).remaining).toBe(2)
    expect(rateLimit('k', 3, 60_000).remaining).toBe(1)
    expect(rateLimit('k', 3, 60_000).remaining).toBe(0)
  })

  it('keeps separate budgets per key', () => {
    expect(rateLimit('a', 1, 60_000).ok).toBe(true)
    expect(rateLimit('a', 1, 60_000).ok).toBe(false)
    // A different key must be unaffected, or one noisy client would lock out all.
    expect(rateLimit('b', 1, 60_000).ok).toBe(true)
  })

  it('resets after the window elapses', () => {
    // Fake timers, NOT a busy-wait. The first version of this test spun on
    // Date.now() for 5ms, which is flaky on Windows where the clock advances in
    // ~15ms steps — it passed and failed on identical code. Controlling the
    // clock makes the assertion about the limiter, not about timer resolution.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      expect(rateLimit('k', 1, 60_000).ok).toBe(true)
      expect(rateLimit('k', 1, 60_000).ok).toBe(false)

      vi.setSystemTime(new Date('2026-01-01T00:01:01Z')) // past the 60s window
      expect(rateLimit('k', 1, 60_000).ok).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a Retry-After of at least 1 second when rejecting', () => {
    rateLimit('k', 1, 60_000)
    const r = rateLimit('k', 1, 60_000)
    expect(r.ok).toBe(false)
    // 0 would tell a client to retry immediately, defeating the limit.
    expect(r.retryAfter).toBeGreaterThanOrEqual(1)
  })

  it('does not grow unboundedly when flooded with distinct keys', () => {
    // A spoofed-IP flood must not turn the limiter itself into the DoS.
    for (let i = 0; i < 12_000; i++) rateLimit(`flood-${i}`, 5, 60_000)
    // Still functional afterwards — the eviction path did not corrupt state.
    expect(rateLimit('after-flood', 1, 60_000).ok).toBe(true)
  })
})

describe('clientKey', () => {
  it('uses the first x-forwarded-for hop', () => {
    const req = new Request('https://x.test', {
      headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    })
    expect(clientKey(req, 'login')).toBe('login:1.2.3.4')
  })

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientKey(new Request('https://x.test', {
      headers: { 'x-real-ip': '9.9.9.9' },
    }), 'login')).toBe('login:9.9.9.9')

    expect(clientKey(new Request('https://x.test'), 'login')).toBe('login:unknown')
  })

  it('namespaces so endpoints cannot drain each other', () => {
    const req = new Request('https://x.test', { headers: { 'x-real-ip': '1.1.1.1' } })
    expect(clientKey(req, 'login')).not.toBe(clientKey(req, 'register'))
  })
})

describe('rateLimitHeaders', () => {
  it('omits Retry-After while under the limit', () => {
    const h = rateLimitHeaders({ ok: true, remaining: 4, retryAfter: 0, limit: 5 })
    expect(h['X-RateLimit-Remaining']).toBe('4')
    expect(h['Retry-After']).toBeUndefined()
  })

  it('includes Retry-After once rejected', () => {
    const h = rateLimitHeaders({ ok: false, remaining: 0, retryAfter: 30, limit: 5 })
    expect(h['Retry-After']).toBe('30')
  })
})
