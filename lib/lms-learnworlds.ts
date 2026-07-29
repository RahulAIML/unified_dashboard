/**
 * lms-learnworlds.ts — the LMS connector (LearnWorlds).
 *
 * WHY THIS EXISTS AS ITS OWN PIPELINE
 * -----------------------------------
 * An LMS measures *course progress*: who is enrolled, how far through they are,
 * whether they completed, and how they scored on graded units. That is NOT what
 * a Simulator/Coach session measures (a scored practice conversation). Before
 * this file, /lms rendered the generic evaluation overview — totalEvaluations /
 * avgScore / passRate — which is Simulator semantics wearing an LMS label. This
 * connector returns real LMS metrics so the two are never conflated again.
 *
 * API SHAPE — VERIFIED AGAINST THE LIVE SCHOOL, NOT ASSUMED
 * ---------------------------------------------------------
 * Probed directly; the endpoints that actually exist are:
 *   GET /admin/api/v2/courses                    -> { data[{id, title, ...}], meta }
 *   GET /admin/api/v2/users                      -> { data[{id, email, ...}], meta }
 *   GET /admin/api/v2/users/{userId}/progress    -> { data[progress row], meta }
 * Notable non-existent paths (all 404, do not reintroduce them):
 *   /v2/*  (the API is under /admin/api/v2)      /admin/api/v2/enrollments
 *   /admin/api/v2/courses/{id}/progress          /admin/api/v2/users/{id}/scores
 * `/admin/api/v2/courses/{id}/users` does return the roster, but the user
 * objects carry NO progress fields, so it cannot drive completion metrics.
 *
 * A progress row is:
 *   { course_id, status, progress_rate, average_score_rate,
 *     completed_units, total_units, time_on_course, completed_at,
 *     progress_per_section_unit }
 * Observed value domains: `status` in {completed, not_started, not_completed};
 * `progress_rate` 0-100; `completed_at` unix SECONDS (int).
 *
 * CREDENTIALS (per-tenant, falling back to the global default)
 *   LMS_API_URL        school URL. Only the ORIGIN is used — the token and API
 *                      paths are derived — so both of these work:
 *                        https://academiaapotex.learnworlds.com
 *                        https://academiaapotex.learnworlds.com/admin/api/
 *   LMS_CLIENT_ID      sent as the `Lw-Client` header on every request
 *   LMS_CLIENT_SECRET  only needed when no static token is supplied
 *   LMS_ACCESS_TOKEN   optional — skips the client-credentials exchange
 *
 * Per-tenant overrides use the upper-cased tenant key, e.g. LMS_APOTEX_API_URL,
 * so a second client with its own school needs no code change.
 *
 * SERVER-ONLY. Never import from a client component: it reads secrets.
 */

import type { ApiTrendPoint, LmsApiResponse, LmsCourseRow } from './types'

const TIMEOUT_MS = 25_000
/** Per-user progress needs one call each; cap in-flight requests. */
const CONCURRENCY = 8
/** One page load hits this route once, but re-renders and range changes repeat it. */
const CACHE_TTL_MS = 60_000

export interface LmsCredentials {
  origin: string
  clientId: string
  clientSecret: string
  accessToken?: string
}

/**
 * Empty-but-valid payload for a tenant with no LMS. `configured: false` is the
 * flag the UI keys its empty state off — the zeros here must never read as
 * "the LMS exists and has no activity".
 */
export const EMPTY_LMS: LmsApiResponse = {
  configured: false,
  enrolledUsers: 0,
  totalUsers: 0,
  totalEnrollments: 0,
  totalCourses: 0,
  modulesCompleted: 0,
  inProgress: 0,
  notStarted: 0,
  completionRate: null,
  avgQuizScore: null,
  hasScoreData: false,
  completionTrend: [],
  courses: [],
}

/**
 * `requireScoped` forbids the shared LMS_* fallback for a named tenant.
 *
 * Multi-tenant safety: without it, setting bare LMS_API_URL would hand ONE
 * school's data to every tenant that asks. Callers resolving a specific tenant
 * must pass it, so a tenant sees an LMS only when LMS_<TENANT>_* exists for it.
 */
function envFor(
  tenantKey: string | null,
  suffix: string,
  requireScoped = false,
): string | undefined {
  if (tenantKey) {
    const scoped = process.env[`LMS_${tenantKey.toUpperCase()}_${suffix}`]
    if (scoped) return scoped
    if (requireScoped) return undefined
  }
  return process.env[`LMS_${suffix}`]
}

/**
 * Resolve credentials for a tenant, or null when the LMS is not configured —
 * callers must render an empty state, never invent numbers.
 *
 * With `requireScoped`, the presence of tenant-scoped credentials is the ONLY
 * signal that a tenant has an LMS. That is deliberate: capability flags like
 * TenantConfig.hasLms cannot serve as the gate, because a tenant defined purely
 * by a pharma_tenants DB row has no static config to read a flag from and the
 * table has no has_lms column — making the flag unreachable for exactly the
 * self-service tenants the builder creates. Credentials, by contrast, always
 * exist wherever the LMS genuinely does.
 */
export function resolveLmsCredentials(
  tenantKey: string | null,
  opts: { requireScoped?: boolean } = {},
): LmsCredentials | null {
  const { requireScoped = false } = opts
  const rawUrl = envFor(tenantKey, 'API_URL', requireScoped)
  const clientId = envFor(tenantKey, 'CLIENT_ID', requireScoped)
  const clientSecret = envFor(tenantKey, 'CLIENT_SECRET', requireScoped)
  const accessToken = envFor(tenantKey, 'ACCESS_TOKEN', requireScoped)

  if (!rawUrl) return null
  // A static token alone is enough to read; otherwise we need the client pair.
  if (!accessToken && !(clientId && clientSecret)) return null

  // Reduce to the origin so a pasted ".../admin/api/" cannot become
  // /admin/api/admin/api/v2.
  let origin: string
  try {
    origin = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`).origin
  } catch {
    return null
  }

  return { origin, clientId: clientId ?? '', clientSecret: clientSecret ?? '', accessToken }
}

export function hasLmsCredentials(
  tenantKey: string | null,
  opts: { requireScoped?: boolean } = {},
): boolean {
  return resolveLmsCredentials(tenantKey, opts) !== null
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface CachedToken { token: string; expiresAt: number }
const _tokenCache = new Map<string, CachedToken>()

/** LearnWorlds requires the `Lw-Client` header even on the token call. */
async function fetchAccessToken(creds: LmsCredentials): Promise<string> {
  const key = `${creds.origin}|${creds.clientId}`
  const hit = _tokenCache.get(key)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token

  const res = await fetch(`${creds.origin}/oauth2/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Lw-Client': creds.clientId,
    },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`LMS token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  }

  const json = await res.json()
  const token: string | undefined = json?.access_token ?? json?.tokenData?.access_token
  if (!token) throw new Error('LMS token exchange returned no access_token')

  const ttl = Number(json?.expires_in ?? json?.tokenData?.expires_in ?? 3600)
  _tokenCache.set(key, { token, expiresAt: Date.now() + ttl * 1000 })
  return token
}

interface Paged<T> { data?: T[]; meta?: { page?: number; totalPages?: number; totalItems?: number } }

async function apiGet<T>(creds: LmsCredentials, path: string): Promise<T> {
  const token = creds.accessToken ?? (await fetchAccessToken(creds))
  const res = await fetch(`${creds.origin}/admin/api/v2${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Lw-Client': creds.clientId,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`LMS GET ${path} failed (${res.status}): ${(await res.text()).slice(0, 160)}`)
  }
  return res.json() as Promise<T>
}

/** Walk `meta.totalPages`, with a hard page cap so a bad `meta` cannot loop forever. */
async function apiGetAll<T>(
  creds: LmsCredentials,
  path: string,
  perPage = 50,
  maxPages = 40,
): Promise<T[]> {
  const out: T[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let page = 1; page <= maxPages; page++) {
    const body = await apiGet<Paged<T>>(creds, `${path}${sep}items_per_page=${perPage}&page=${page}`)
    const rows = body?.data
    if (!Array.isArray(rows) || rows.length === 0) break
    out.push(...rows)
    const total = body?.meta?.totalPages
    if (!total || page >= total) break
  }
  return out
}

/** Bounded-concurrency map. Keeps ~50 per-user progress calls civil. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface RawCourse { id?: string; title?: string }
interface RawUser { id?: string }
interface RawProgress {
  course_id?: string
  status?: string
  progress_rate?: number
  average_score_rate?: number
  completed_units?: number
  total_units?: number
  completed_at?: number | string | null
}

/** `completed_at` is unix SECONDS on this API; tolerate millis and ISO too. */
function toDateKey(v: unknown): string | null {
  if (v == null || v === '') return null
  let d: Date
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v)
  else {
    const s = String(v)
    d = /^\d+$/.test(s)
      ? new Date(Number(s) < 1e12 ? Number(s) * 1000 : Number(s))
      : new Date(s)
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

interface CacheEntry { at: number; value: LmsApiResponse }
const _cache = new Map<string, CacheEntry>()
const _inflight = new Map<string, Promise<LmsApiResponse>>()

/**
 * Build the LMS payload for a date range.
 *
 * `from`/`to` filter the completion trend only. Enrollment, course and status
 * counts are current-state figures — an LMS roster is a snapshot, not a time
 * series — which is why their KPI cards carry no period-over-period delta.
 */
export async function lmsDashboard(
  tenantKey: string | null,
  from: Date,
  to: Date,
): Promise<LmsApiResponse> {
  // requireScoped must match the gate in /api/dashboard/modules exactly. If the
  // tab is shown on scoped credentials but the data resolved via the shared
  // LMS_* fallback, a tenant could be shown another tenant's school.
  const creds = resolveLmsCredentials(tenantKey, { requireScoped: true })
  if (!creds) return EMPTY_LMS

  const fromKey = from.toISOString().slice(0, 10)
  const toKey = to.toISOString().slice(0, 10)
  const cacheKey = `${creds.origin}|${tenantKey ?? '-'}|${fromKey}|${toKey}`

  const cached = _cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
  const flying = _inflight.get(cacheKey)
  if (flying) return flying

  const job = (async () => {
    const [courses, users] = await Promise.all([
      apiGetAll<RawCourse>(creds, '/courses'),
      apiGetAll<RawUser>(creds, '/users'),
    ])

    const title = new Map<string, string>()
    for (const c of courses) {
      if (c.id) title.set(String(c.id), String(c.title ?? c.id))
    }

    // One call per user returns that user's progress across every course.
    const perUser = await mapLimit(
      users.map(u => String(u.id ?? '')).filter(Boolean),
      CONCURRENCY,
      async uid => {
        try {
          const body = await apiGet<Paged<RawProgress>>(creds, `/users/${uid}/progress`)
          return { uid, rows: Array.isArray(body?.data) ? body.data : [] }
        } catch {
          // A user with no progress 404s; that is data, not an outage.
          return { uid, rows: [] as RawProgress[] }
        }
      },
    )

    interface Agg { enrolled: number; completed: number; inProgress: number; scoreSum: number; scoreN: number }
    const perCourse = new Map<string, Agg>()
    const trend = new Map<string, number>()

    let enrolledUsers = 0
    let totalEnrollments = 0
    let completed = 0
    let inProgress = 0
    let notStarted = 0
    let scoreSum = 0
    let scoreN = 0

    for (const { rows } of perUser) {
      if (rows.length > 0) enrolledUsers++

      for (const r of rows) {
        totalEnrollments++
        const cid = String(r.course_id ?? '')
        const agg = perCourse.get(cid) ??
          { enrolled: 0, completed: 0, inProgress: 0, scoreSum: 0, scoreN: 0 }
        agg.enrolled++

        const status = (r.status ?? '').toLowerCase()
        const done = status === 'completed'
        if (done) {
          completed++
          agg.completed++
          const key = toDateKey(r.completed_at)
          if (key && key >= fromKey && key <= toKey) {
            trend.set(key, (trend.get(key) ?? 0) + 1)
          }
        } else if (status === 'not_started') {
          notStarted++
        } else {
          inProgress++
          agg.inProgress++
        }

        // LearnWorlds reports average_score_rate = 0 for courses with no graded
        // units, which is indistinguishable from a genuine zero. Only positive
        // values are counted, and `hasScoreData` tells the UI whether any
        // graded assessment exists at all — reporting a flat 0 would read as
        // catastrophic performance when nothing was ever graded.
        const score = Number(r.average_score_rate ?? 0)
        if (Number.isFinite(score) && score > 0) {
          scoreSum += score
          scoreN++
          agg.scoreSum += score
          agg.scoreN++
        }

        perCourse.set(cid, agg)
      }
    }

    const courseRows: LmsCourseRow[] = [...perCourse.entries()]
      .map(([cid, a]) => ({
        courseId: cid,
        name: title.get(cid) || cid || 'Unknown course',
        enrolled: a.enrolled,
        completed: a.completed,
        inProgress: a.inProgress,
        completionRate: a.enrolled > 0 ? Math.round((a.completed / a.enrolled) * 1000) / 10 : null,
        avgScore: a.scoreN > 0 ? Math.round((a.scoreSum / a.scoreN) * 10) / 10 : null,
      }))
      .sort((x, y) => y.enrolled - x.enrolled || x.name.localeCompare(y.name))

    const completionTrend: ApiTrendPoint[] = [...trend.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }))

    const value: LmsApiResponse = {
      configured: true,
      enrolledUsers,
      totalUsers: users.length,
      totalEnrollments,
      totalCourses: courses.length,
      modulesCompleted: completed,
      inProgress,
      notStarted,
      // Null, not zero, when there is nothing to divide by.
      completionRate: totalEnrollments > 0
        ? Math.round((completed / totalEnrollments) * 1000) / 10
        : null,
      avgQuizScore: scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) / 10 : null,
      hasScoreData: scoreN > 0,
      completionTrend,
      courses: courseRows,
    }

    _cache.set(cacheKey, { at: Date.now(), value })
    return value
  })()

  _inflight.set(cacheKey, job)
  try {
    return await job
  } finally {
    _inflight.delete(cacheKey)
  }
}

/** Cheap liveness probe for module gating and the dashboard builder. */
export async function lmsProbe(tenantKey: string | null): Promise<{
  configured: boolean
  alive: boolean
  courses: number
  note: string
}> {
  const creds = resolveLmsCredentials(tenantKey)
  if (!creds) {
    return { configured: false, alive: false, courses: 0, note: 'No LMS credentials configured' }
  }
  try {
    const body = await apiGet<Paged<RawCourse>>(creds, '/courses?items_per_page=1&page=1')
    return {
      configured: true,
      alive: true,
      courses: body?.meta?.totalItems ?? (body?.data?.length ?? 0),
      note: 'OK',
    }
  } catch (err) {
    return {
      configured: true,
      alive: false,
      courses: 0,
      note: err instanceof Error ? err.message : 'Unknown LMS error',
    }
  }
}
