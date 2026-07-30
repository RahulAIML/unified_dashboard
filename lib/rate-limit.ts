/**
 * lib/rate-limit.ts — fixed-window rate limiting.
 *
 * SCOPE, STATED UP FRONT: counters live in THIS PROCESS's memory. With N
 * instances the effective limit is N × the configured limit, and a restart
 * resets every window. That is a real limitation, not an oversight — it is
 * accepted deliberately because:
 *
 *   - the alternative today is NO limiting at all, and a per-instance limit
 *     still defeats credential stuffing and runaway AI spend, and
 *   - the shared-state replacement (Redis) is Phase 2/6 work that also fixes
 *     the same defect in tenant-config caching (see lib/pharma-tenant.ts).
 *
 * When Redis lands, swap the Store implementation below and keep the API.
 * Do NOT treat this as a security boundary for a distributed deployment.
 */

export interface RateLimitResult {
  ok: boolean
  /** Requests remaining in the current window. */
  remaining: number
  /** Seconds until the window resets — send as Retry-After. */
  retryAfter: number
  limit: number
}

interface Window {
  count: number
  resetAt: number
}

/**
 * Bounded so a flood of distinct keys (spoofed IPs) cannot grow this map
 * without limit — that would turn the rate limiter itself into the DoS.
 */
const MAX_TRACKED_KEYS = 10_000
const buckets = new Map<string, Window>()

/** Drop expired windows; if still oversized, evict oldest-resetting first. */
function evictIfNeeded(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return
  for (const [key, w] of buckets) if (w.resetAt <= now) buckets.delete(key)
  if (buckets.size < MAX_TRACKED_KEYS) return
  const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
  for (let i = 0; i < Math.ceil(sorted.length / 4); i++) buckets.delete(sorted[i][0])
}

/**
 * Consume one unit for `key`. Call once per request, before doing real work.
 *
 * @param key    identity to limit on — namespace it ('login:1.2.3.4') so
 *               different endpoints cannot exhaust each other's budget.
 * @param limit  requests permitted per window.
 * @param windowMs window length in ms.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  evictIfNeeded(now)

  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: limit - 1, retryAfter: 0, limit }
  }

  existing.count++
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfter, limit }
  }
  return { ok: true, remaining: limit - existing.count, retryAfter: 0, limit }
}

/**
 * Best-effort client identity for unauthenticated endpoints.
 *
 * Trusts x-forwarded-for's FIRST hop, which a client CAN spoof unless the
 * platform overwrites the header (Render and Vercel both do). Documented
 * because on a platform that does not, this degrades to a shared bucket
 * rather than silently limiting nothing.
 */
export function clientKey(request: Request, namespace: string): string {
  const fwd = request.headers.get('x-forwarded-for')
  const ip = fwd?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  return `${namespace}:${ip}`
}

/** Headers to attach so clients can back off intelligently. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
  }
  if (!r.ok) h['Retry-After'] = String(r.retryAfter)
  return h
}

/** Test-only: clear all windows. */
export function __resetRateLimits(): void {
  buckets.clear()
}
