/**
 * Shared cache layer -- Redis-backed when REDIS_URL is configured, an
 * in-process Map otherwise, so every caller works identically in both
 * environments and nothing crashes if Redis is unset or briefly unreachable.
 *
 * WHY THIS EXISTS: lib/lms-learnworlds.ts already had its own ad hoc
 * in-process `_cache` Map (ROADMAP Phase 6's "known target: /api/dashboard/lms
 * cold call measured at 14.2s") -- correct for a single instance, but on a
 * horizontally-scaled deploy (multiple Next.js instances/serverless
 * invocations) each instance has its own empty cache, so the same tenant's
 * expensive LearnWorlds aggregation re-runs once per instance instead of
 * once total. This module lets that kind of cache be shared across
 * instances via Redis, while still degrading gracefully to the old
 * per-instance behavior wherever REDIS_URL isn't set (e.g. local dev).
 *
 * SERVER-ONLY. ioredis is dynamically imported so this file has zero cost
 * for any caller that never configures REDIS_URL.
 */

interface MemoryEntry {
  expiresAt: number
  value: string
}

// `undefined` = connection not yet attempted; `null` = attempted and
// unavailable (unset REDIS_URL, or connect failed) -- distinct states so a
// failed connect attempt is not retried on every single cache call.
let redisClient: import('ioredis').Redis | null | undefined
let redisInitPromise: Promise<import('ioredis').Redis | null> | null = null

const memoryStore = new Map<string, MemoryEntry>()

async function getRedis(): Promise<import('ioredis').Redis | null> {
  if (redisClient !== undefined) return redisClient
  if (redisInitPromise) return redisInitPromise

  redisInitPromise = (async () => {
    const url = process.env.REDIS_URL
    if (!url) {
      redisClient = null
      return null
    }
    try {
      const { default: Redis } = await import('ioredis')
      const client = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        // Never let a slow/unreachable Redis hang a request queue forever --
        // one failed retry and callers fall back to the in-process store.
        retryStrategy: () => null,
      })
      client.on('error', () => { /* swallowed -- callers fall back to memory */ })
      await client.connect()
      redisClient = client
      return client
    } catch {
      redisClient = null
      return null
    }
  })()

  return redisInitPromise
}

function memoryGet<T>(key: string): T | null {
  const hit = memoryStore.get(key)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return JSON.parse(hit.value) as T
}

function memorySet(key: string, serialized: string, ttlSeconds: number): void {
  memoryStore.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value: serialized })
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = await getRedis()
  if (client) {
    try {
      const raw = await client.get(key)
      return raw !== null ? (JSON.parse(raw) as T) : null
    } catch {
      // Redis reachable at connect time but failing now (e.g. transient
      // network blip) -- fall back to whatever the in-process store has
      // rather than treating this request as a hard miss.
    }
  }
  return memoryGet<T>(key)
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const serialized = JSON.stringify(value)
  const client = await getRedis()
  if (client) {
    try {
      await client.set(key, serialized, 'EX', Math.max(1, Math.trunc(ttlSeconds)))
      return
    } catch {
      // fall through to memory
    }
  }
  memorySet(key, serialized, ttlSeconds)
}

/**
 * Returns the cached value for `key` if fresh, otherwise calls fn(), caches
 * the result, and returns it. The one call most callers actually want.
 */
export async function getOrSetCache<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const cached = await cacheGet<T>(key)
  if (cached !== null) return cached
  const value = await fn()
  await cacheSet(key, value, ttlSeconds)
  return value
}
