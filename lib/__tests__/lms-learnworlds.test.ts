/**
 * Aggregation tests for the LearnWorlds LMS connector.
 *
 * The endpoint shapes and value domains encoded in the fixture below were
 * observed against a live school (see lib/lms-learnworlds.ts header), so these
 * are not guesses about the API — they pin the arithmetic that turns those
 * responses into KPIs.
 *
 * `lmsDashboard` memoizes per (origin, tenant, range) for 60s at module scope,
 * so every test re-imports the module through `freshModule()` to get a cold
 * cache. Sharing it would let one test's payload satisfy another's assertions.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const ORIGIN = 'https://school.learnworlds.com'

/** Reset the module registry so the 60s response cache starts empty. */
async function freshModule() {
  vi.resetModules()
  return import('../lms-learnworlds')
}

interface ProgressRow {
  course_id: string
  status: string
  average_score_rate?: number
  completed_at?: number | string | null
}

/**
 * Stand in for the LearnWorlds REST API.
 *
 * Courses are served across two pages with `meta.totalPages: 2` to exercise the
 * pagination walk; a user absent from `progress` 404s, which is how the real API
 * reports "this user has no enrollments".
 */
function installFetchMock(opts: {
  courses?: { id: string; title: string }[][]
  users?: { id: string }[]
  progress?: Record<string, ProgressRow[]>
} = {}) {
  const courses = opts.courses ?? [
    [{ id: 'c1', title: 'Intro' }, { id: 'c2', title: 'Advanced' }],
    [{ id: 'c3', title: 'Compliance' }],
  ]
  const users = opts.users ?? [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }, { id: 'u4' }]
  const progress = opts.progress ?? {}
  const calls: string[] = []

  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input)
    calls.push(url)

    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    if (url.includes('/oauth2/access_token')) {
      return json({ access_token: 'tok-abc', expires_in: 3600 })
    }

    if (url.includes('/courses')) {
      const page = Number(new URL(url).searchParams.get('page') ?? '1')
      return json({ data: courses[page - 1] ?? [], meta: { totalPages: courses.length } })
    }

    const progressMatch = url.match(/\/users\/([^/]+)\/progress/)
    if (progressMatch) {
      const rows = progress[progressMatch[1]]
      // A user with no enrollments 404s on the real API.
      if (!rows) return new Response('not found', { status: 404 })
      return json({ data: rows })
    }

    if (url.includes('/users')) {
      const page = Number(new URL(url).searchParams.get('page') ?? '1')
      return json({ data: page === 1 ? users : [], meta: { totalPages: 1 } })
    }

    throw new Error(`unexpected fetch: ${url}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, calls }
}

/**
 * u1/u2/u3 carry progress; u4 404s. Enrollment totals and per-course figures
 * below are hand-computed from this table, not copied from a run.
 */
const STANDARD_PROGRESS: Record<string, ProgressRow[]> = {
  u1: [
    { course_id: 'c1', status: 'completed', average_score_rate: 80, completed_at: 1720000000 },
    { course_id: 'c2', status: 'not_started', average_score_rate: 0 },
  ],
  u2: [
    { course_id: 'c1', status: 'completed', average_score_rate: 90, completed_at: 1720086400 },
    { course_id: 'c3', status: 'not_completed', average_score_rate: 0 },
  ],
  u3: [{ course_id: 'c1', status: 'not_started' }],
}

const JULY = { from: new Date('2024-07-01T00:00:00Z'), to: new Date('2024-07-31T00:00:00Z') }

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('LMS_')) delete process.env[k]
  }
  // Shared fallback, used by the null-tenant and precedence cases.
  process.env.LMS_API_URL = ORIGIN
  process.env.LMS_CLIENT_ID = 'cid'
  process.env.LMS_CLIENT_SECRET = 'secret'
  // Apotex is configured the way a real tenant is: its OWN scoped credentials.
  // lmsDashboard() requires scoped credentials for a named tenant, so shared
  // vars alone would (correctly) resolve to EMPTY_LMS and test nothing.
  process.env.LMS_APOTEX_API_URL = ORIGIN
  process.env.LMS_APOTEX_CLIENT_ID = 'cid'
  process.env.LMS_APOTEX_CLIENT_SECRET = 'secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveLmsCredentials', () => {
  it('returns null when no URL is configured, so callers render an empty state', async () => {
    delete process.env.LMS_API_URL
    delete process.env.LMS_APOTEX_API_URL
    const { resolveLmsCredentials } = await freshModule()
    expect(resolveLmsCredentials('apotex')).toBeNull()
  })

  it('returns null when neither a static token nor a client pair is present', async () => {
    delete process.env.LMS_CLIENT_SECRET
    const { resolveLmsCredentials } = await freshModule()
    expect(resolveLmsCredentials(null)).toBeNull()
  })

  it('accepts a static access token without client credentials', async () => {
    delete process.env.LMS_CLIENT_ID
    delete process.env.LMS_CLIENT_SECRET
    process.env.LMS_ACCESS_TOKEN = 'static-tok'
    const { resolveLmsCredentials } = await freshModule()
    expect(resolveLmsCredentials(null)).toMatchObject({ accessToken: 'static-tok' })
  })

  it('reduces a pasted API path to the origin so /admin/api cannot double up', async () => {
    process.env.LMS_API_URL = `${ORIGIN}/admin/api/`
    const { resolveLmsCredentials } = await freshModule()
    expect(resolveLmsCredentials(null)?.origin).toBe(ORIGIN)
  })

  it('prefers the tenant-scoped env var over the shared one', async () => {
    process.env.LMS_APOTEX_API_URL = 'https://apotex.learnworlds.com'
    const { resolveLmsCredentials } = await freshModule()
    expect(resolveLmsCredentials('apotex')?.origin).toBe('https://apotex.learnworlds.com')
    expect(resolveLmsCredentials('sanfer')?.origin).toBe(ORIGIN)
  })

  describe('requireScoped', () => {
    it('resolves a tenant that has its own scoped credentials', async () => {
      process.env.LMS_APOTEX_API_URL = 'https://apotex.learnworlds.com'
      process.env.LMS_APOTEX_CLIENT_ID = 'a-cid'
      process.env.LMS_APOTEX_CLIENT_SECRET = 'a-secret'
      const { hasLmsCredentials } = await freshModule()

      expect(hasLmsCredentials('apotex', { requireScoped: true })).toBe(true)
    })

    it('refuses to fall back to shared credentials for a named tenant', async () => {
      // Only shared LMS_* is set (from beforEach). Without requireScoped, EVERY
      // tenant would inherit this one school — a cross-tenant data leak.
      const { hasLmsCredentials } = await freshModule()

      expect(hasLmsCredentials('sanfer')).toBe(true)
      expect(hasLmsCredentials('sanfer', { requireScoped: true })).toBe(false)
    })

    it('will not mix a scoped URL with a shared secret', async () => {
      // A half-configured tenant must not silently borrow the other half.
      delete process.env.LMS_APOTEX_CLIENT_ID
      delete process.env.LMS_APOTEX_CLIENT_SECRET
      process.env.LMS_APOTEX_API_URL = 'https://apotex.learnworlds.com'
      const { resolveLmsCredentials } = await freshModule()

      expect(resolveLmsCredentials('apotex', { requireScoped: true })).toBeNull()
    })

    it('still allows shared credentials when there is no tenant key', async () => {
      // Single-tenant deployments configure bare LMS_* and have no tenant key.
      const { hasLmsCredentials } = await freshModule()

      expect(hasLmsCredentials(null, { requireScoped: true })).toBe(true)
    })
  })
})

describe('lmsDashboard — unconfigured tenant', () => {
  it('returns configured:false and makes no network calls', async () => {
    delete process.env.LMS_API_URL
    const { fetchMock } = installFetchMock()
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('sanfer', JULY.from, JULY.to)

    expect(res.configured).toBe(false)
    expect(res.completionRate).toBeNull()
    expect(res.avgQuizScore).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('lmsDashboard — aggregation', () => {
  it('computes enrollment, status and completion figures from the fixture', async () => {
    installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.configured).toBe(true)
    // 3 courses across 2 pages — proves the pagination walk concatenates.
    expect(res.totalCourses).toBe(3)
    expect(res.totalUsers).toBe(4)
    // u4 404s on progress, so it is a user but not an enrolled user.
    expect(res.enrolledUsers).toBe(3)
    expect(res.totalEnrollments).toBe(5)
    expect(res.modulesCompleted).toBe(2)
    // 'not_completed' is in-progress; only 'not_started' is untouched.
    expect(res.inProgress).toBe(1)
    expect(res.notStarted).toBe(2)
    // The three status buckets must exactly partition the enrollments.
    expect(res.modulesCompleted + res.inProgress + res.notStarted).toBe(res.totalEnrollments)
    // Against the FULL roster (4 users x 3 courses = 12 possible), not just
    // the 5 that happened to enroll: 2/12 = 16.7%.
    expect(res.completionRate).toBe(16.7)
  })

  it('averages only graded rows, ignoring the 0s that mean "not graded"', async () => {
    installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    // (80 + 90) / 2 — the three 0/absent rows must not drag this toward 34.
    expect(res.avgQuizScore).toBe(85)
    expect(res.hasScoreData).toBe(true)
  })

  it('reports null (never 0) when a school has no graded units at all', async () => {
    // This is the real Apotex case: average_score_rate is 0 on every row.
    // A 0 here would render as "everyone scored zero" instead of "never graded".
    installFetchMock({
      progress: {
        u1: [{ course_id: 'c1', status: 'completed', average_score_rate: 0, completed_at: 1720000000 }],
        u2: [{ course_id: 'c1', status: 'not_completed', average_score_rate: 0 }],
      },
    })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.avgQuizScore).toBeNull()
    expect(res.hasScoreData).toBe(false)
    // Completion still reports normally — only the score is unknown.
    // 1 completed / (4 users x 3 courses = 12 possible) = 8.3%.
    expect(res.completionRate).toBe(8.3)
  })

  it('reports a real 0% (not null) when nobody has enrolled but a real roster exists', async () => {
    installFetchMock({ progress: {} })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.totalEnrollments).toBe(0)
    expect(res.enrolledUsers).toBe(0)
    // completionRate is now against the roster (4 users x 3 courses = 12
    // possible), which IS known even with zero enrollments -- 0/12 is a
    // real, meaningful 0%, not "nothing to divide by". null is reserved for
    // when totalUsers or totalCourses is itself 0 (see the next test).
    expect(res.completionRate).toBe(0)
    expect(res.avgQuizScore).toBeNull()
    // The roster is still real, and still worth showing.
    expect(res.totalUsers).toBe(4)
  })

  it('reports null (not 0) when the school genuinely has zero users to divide by', async () => {
    installFetchMock({ users: [], progress: {} })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.totalUsers).toBe(0)
    expect(res.completionRate).toBeNull()
  })

  it('builds per-course rows sorted by enrollment then name', async () => {
    installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.courses.map(c => c.name)).toEqual(['Intro', 'Advanced', 'Compliance'])

    const intro = res.courses[0]
    expect(intro).toMatchObject({ courseId: 'c1', enrolled: 3, completed: 2, inProgress: 0, totalUsers: 4 })
    // Against the full roster (4 users), not just the 3 who enrolled: 2/4 = 50%.
    expect(intro.completionRate).toBe(50)
    expect(intro.avgScore).toBe(85)

    // Ungraded course: a rate of 0 is real, but the score is unknown.
    const compliance = res.courses.find(c => c.courseId === 'c3')!
    expect(compliance).toMatchObject({ enrolled: 1, completed: 0, inProgress: 1, completionRate: 0, totalUsers: 4 })
    expect(compliance.avgScore).toBeNull()
  })

  it('resolves course titles, falling back to the id for unknown courses', async () => {
    installFetchMock({
      courses: [[{ id: 'c1', title: 'Intro' }]],
      progress: { u1: [{ course_id: 'c9', status: 'not_started' }] },
    })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.courses[0].name).toBe('c9')
  })
})

describe('lmsDashboard — completion trend', () => {
  it('reads completed_at as unix SECONDS and buckets by UTC day', async () => {
    installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    // 1720000000s = 2024-07-03T09:46:40Z, 1720086400s = 2024-07-04T09:46:40Z.
    // Misreading these as millis would land in 1970 and drop out of range.
    expect(res.completionTrend).toEqual([
      { date: '2024-07-03', value: 1 },
      { date: '2024-07-04', value: 1 },
    ])
  })

  it('filters the trend by range without changing the current-state totals', async () => {
    installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', new Date('2024-07-04T00:00:00Z'), JULY.to)

    // Only the 07-04 completion falls in range...
    expect(res.completionTrend).toEqual([{ date: '2024-07-04', value: 1 }])
    // ...but the roster snapshot is not a time series, so totals are unchanged.
    expect(res.modulesCompleted).toBe(2)
    expect(res.completionRate).toBe(16.7)
  })

  it('counts a completion with a missing timestamp without inventing a date', async () => {
    installFetchMock({
      progress: { u1: [{ course_id: 'c1', status: 'completed', completed_at: null }] },
    })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.modulesCompleted).toBe(1)
    expect(res.completionTrend).toEqual([])
  })

  it('accepts an ISO completed_at as well as an epoch', async () => {
    installFetchMock({
      progress: { u1: [{ course_id: 'c1', status: 'completed', completed_at: '2024-07-10T12:00:00Z' }] },
    })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.completionTrend).toEqual([{ date: '2024-07-10', value: 1 }])
  })
})

describe('lmsDashboard — transport', () => {
  it('treats status casing as insignificant', async () => {
    installFetchMock({
      progress: { u1: [{ course_id: 'c1', status: 'COMPLETED', completed_at: 1720000000 }] },
    })
    const { lmsDashboard } = await freshModule()

    const res = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(res.modulesCompleted).toBe(1)
    expect(res.inProgress).toBe(0)
  })

  it('calls /admin/api/v2 with a bearer token and the Lw-Client header', async () => {
    const { calls, fetchMock } = installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(calls.some(u => u.startsWith(`${ORIGIN}/admin/api/v2/courses?`))).toBe(true)
    expect(calls).toContain(`${ORIGIN}/admin/api/v2/users/u1/progress`)
    // No path should ever contain a doubled prefix.
    expect(calls.every(u => !u.includes('/admin/api/admin/api'))).toBe(true)

    const progressCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/progress'))!
    const headers = progressCall[1]!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-abc')
    expect(headers['Lw-Client']).toBe('cid')
  })

  it('serves a repeat call from cache instead of refetching', async () => {
    const { fetchMock } = installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    const first = await lmsDashboard('apotex', JULY.from, JULY.to)
    const callsAfterFirst = fetchMock.mock.calls.length
    const second = await lmsDashboard('apotex', JULY.from, JULY.to)

    expect(second).toEqual(first)
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('dedupes concurrent identical requests into one fetch burst', async () => {
    const { fetchMock } = installFetchMock({ progress: STANDARD_PROGRESS })
    const { lmsDashboard } = await freshModule()

    const [a, b] = await Promise.all([
      lmsDashboard('apotex', JULY.from, JULY.to),
      lmsDashboard('apotex', JULY.from, JULY.to),
    ])

    expect(a).toEqual(b)
    // One call per user in the roster — u4 is still asked before it 404s.
    // Without in-flight dedupe both callers would drive a full set, i.e. 8.
    const progressCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/progress'))
    expect(progressCalls.length).toBe(4)
  })
})
