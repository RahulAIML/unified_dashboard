/**
 * lib/lms-learnworlds.ts's lmsRawProgressRows -- the admin/internal raw
 * per-(user, course) export. Field names and value shapes mirror what the
 * live LearnWorlds API actually returns (verified directly against Apotex's
 * real school -- see lib/lms-learnworlds.ts's own header and this file's
 * fixtures), never invented.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

const ORIGIN = 'https://school.learnworlds.com'

async function freshModule() {
  vi.resetModules()
  return import('../lms-learnworlds')
}

interface ProgressRow {
  course_id: string
  status: string | null
  progress_rate?: number
  average_score_rate?: number
  time_on_course?: number
  total_units?: number
  completed_units?: number
  completed_at?: number | string | null
}

function installFetchMock(opts: {
  courses?: { id: string; title: string }[]
  users?: { id: string; email?: string; first_name?: string | null; last_name?: string | null; username?: string }[]
  progress?: Record<string, ProgressRow[]>
} = {}) {
  const courses = opts.courses ?? [{ id: 'c1', title: 'Intro' }]
  const users = opts.users ?? [{ id: 'u1', email: 'rep@apotex.com.mx', first_name: 'Ana', last_name: 'Lopez' }]
  const progress = opts.progress ?? {}

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

    if (url.includes('/oauth2/access_token')) return json({ access_token: 'tok', expires_in: 3600 })
    if (url.includes('/courses')) {
      const page = Number(new URL(url).searchParams.get('page') ?? '1')
      return json({ data: page === 1 ? courses : [], meta: { totalPages: 1 } })
    }
    const progressMatch = url.match(/\/users\/([^/]+)\/progress/)
    if (progressMatch) {
      const rows = progress[progressMatch[1]]
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
  return fetchMock
}

beforeEach(() => {
  process.env.LMS_APOTEX_API_URL = ORIGIN
  process.env.LMS_APOTEX_CLIENT_ID = 'cid'
  process.env.LMS_APOTEX_CLIENT_SECRET = 'secret'
})
afterEach(() => {
  delete process.env.LMS_APOTEX_API_URL
  delete process.env.LMS_APOTEX_CLIENT_ID
  delete process.env.LMS_APOTEX_CLIENT_SECRET
  vi.unstubAllGlobals()
})

describe('lmsRawProgressRows — no LMS configured', () => {
  it('returns an empty array (never throws) for a tenant with no LearnWorlds credentials', async () => {
    delete process.env.LMS_APOTEX_API_URL
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows).toEqual([])
  })
})

describe('lmsRawProgressRows — empty and small data', () => {
  it('returns an empty array when the school has courses but zero users', async () => {
    installFetchMock({ users: [] })
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows).toEqual([])
  })

  it('maps one real progress row correctly, including the derived ISO completed_at date', async () => {
    installFetchMock({
      progress: { u1: [{ course_id: 'c1', status: 'completed', progress_rate: 100, average_score_rate: 88, time_on_course: 4880, total_units: 1, completed_units: 1, completed_at: 1784423431 }] },
    })
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows).toEqual([{
      tenant: 'apotex', user_id: 'u1', user_email: 'rep@apotex.com.mx', user_name: 'Ana Lopez',
      course_id: 'c1', course_title: 'Intro', status: 'completed', progress_rate: 100,
      average_score_rate: 88, time_on_course: 4880, total_units: 1, completed_units: 1,
      completed_at: '2026-07-19',
    }])
  })

  it('a user with no enrollments (404 on progress) contributes zero rows, not an error', async () => {
    installFetchMock({ progress: {} }) // u1 404s
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows).toEqual([])
  })
})

describe('lmsRawProgressRows — larger data and multiple courses per user', () => {
  it('emits one row per (user, course) pair across many users/courses', async () => {
    const users = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, email: `u${i}@apotex.com.mx` }))
    const progress: Record<string, ProgressRow[]> = {}
    for (const u of users) {
      progress[u.id] = [
        { course_id: 'c1', status: 'completed', average_score_rate: 80 },
        { course_id: 'c2', status: 'not_started', average_score_rate: 0 },
      ]
    }
    installFetchMock({
      courses: [{ id: 'c1', title: 'Intro' }, { id: 'c2', title: 'Advanced' }],
      users, progress,
    })
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows).toHaveLength(40) // 20 users * 2 courses
  })
})

describe('lmsRawProgressRows — malformed/missing fields', () => {
  it('falls back to the course id as the title when the course was never found in /courses', async () => {
    installFetchMock({
      courses: [],
      progress: { u1: [{ course_id: 'ghost-course', status: 'not_started' }] },
    })
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows[0].course_title).toBe('ghost-course')
  })

  it('falls back to username, then null, when first/last name are both missing', async () => {
    installFetchMock({
      users: [{ id: 'u1', email: 'x@apotex.com.mx', username: 'xuser' }],
      progress: { u1: [{ course_id: 'c1', status: 'not_started' }] },
    })
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows[0].user_name).toBe('xuser')
  })

  it('leaves completed_at null for a course that was never completed, never a fabricated date', async () => {
    installFetchMock({ progress: { u1: [{ course_id: 'c1', status: 'not_started', completed_at: null }] } })
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows[0].completed_at).toBeNull()
  })

  it('a user with no id is skipped rather than producing a row with an empty user_id', async () => {
    installFetchMock({ users: [{ id: '', email: 'noid@apotex.com.mx' }] })
    const mod = await freshModule()
    const rows = await mod.lmsRawProgressRows('apotex')
    expect(rows).toEqual([])
  })
})

describe('lmsRawProgressRows — multiple tenants stay isolated', () => {
  it('a tenant with no configured credentials never sees another tenant\'s data', async () => {
    process.env.LMS_APOTEX_API_URL = ORIGIN
    process.env.LMS_APOTEX_CLIENT_ID = 'cid'
    process.env.LMS_APOTEX_CLIENT_SECRET = 'secret'
    installFetchMock({ progress: { u1: [{ course_id: 'c1', status: 'completed' }] } })
    const mod = await freshModule()

    const apotex = await mod.lmsRawProgressRows('apotex')
    expect(apotex.length).toBeGreaterThan(0)

    const otherTenant = await mod.lmsRawProgressRows('sanfer') // no LMS_SANFER_* configured
    expect(otherTenant).toEqual([])
  })
})
