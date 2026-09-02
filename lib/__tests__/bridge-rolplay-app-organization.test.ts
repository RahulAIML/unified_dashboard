/**
 * Regression: rolplayAppOrganization is the rolplay-app equivalent of
 * pharmaDashboardOrganization -- app/organization/page.tsx (and its nav item
 * in components/Sidebar.tsx) previously only ever rendered for pharma
 * tenants, so a rolplay-app tenant (e.g. Chinoin: 581 real r_user accounts,
 * only 1 with any session) had no way to see its own roster at all. This
 * must return EVERY registered account -- including the ones with zero
 * sessions -- annotated with real per-user activity, never u.password, and
 * never scoped to a date range (account existence isn't a time-windowed
 * question).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchSpy = vi.fn()

async function fresh() {
  vi.resetModules()
  process.env.ROLPLAY_APP_SQL_URL = 'https://sql.test/exec'
  return import('../bridge-rolplay-app')
}

function respond(data: unknown[]) {
  return new Response(JSON.stringify({ result: 'success', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => vi.unstubAllGlobals())

describe('rolplayAppOrganization', () => {
  it('returns every registered user, including one with zero sessions', async () => {
    const mod = await fresh()
    const sqlCalls: string[] = []
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      sqlCalls.push(body.sql)
      if (body.sql.includes('FROM r_user_session')) {
        // Only user 1 has a session -- user 2 must still appear in the roster.
        return respond([{ user_id: 1, sessions: 3, avg: '80.5', last_session: '2026-09-01 10:00:00', categories: 'COACH' }])
      }
      return respond([
        { id: 1, name: 'Claudia Salinas', email: 'claudia@chinoin.com', department: 'Rinitis', designation: 'Gerente', created_on: '2026-09-01 23:50:01', last_loggedin: null, disabled: 0 },
        { id: 2, name: 'Tester Chinoin', email: 'tester@chinoin.com', department: '', designation: 'staff', created_on: '2026-08-12 15:07:38', last_loggedin: null, disabled: 0 },
      ])
    })

    const data = await mod.rolplayAppOrganization(37)

    expect(data.totalMembers).toBe(2)
    expect(data.members).toHaveLength(2)
    const user2 = data.members.find(m => m.id === 2)!
    expect(user2.sessions).toBe(0)
    expect(user2.modulesUsed).toEqual([])
    expect(user2.lastSessionAt).toBeNull()
  })

  it("maps a user's session categories to the dashboard's own module names", async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (body.sql.includes('FROM r_user_session')) {
        return respond([{ user_id: 1, sessions: 5, avg: '70', last_session: '2026-09-01 10:00:00', categories: 'COACH,SIM' }])
      }
      return respond([{ id: 1, name: 'A', email: 'a@x.com', department: null, designation: null, created_on: '2026-01-01', last_loggedin: null, disabled: 0 }])
    })

    const data = await mod.rolplayAppOrganization(37)
    expect(data.members[0].modulesUsed).toEqual(['coach', 'simulator'])
    expect(data.members[0].sessions).toBe(5)
    expect(data.members[0].lastSessionAt).toBe('2026-09-01 10:00:00')
  })

  it('reports status active/disabled from r_user.disabled', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (body.sql.includes('FROM r_user_session')) return respond([])
      return respond([
        { id: 1, name: 'A', email: 'a@x.com', department: null, designation: null, created_on: '2026-01-01', last_loggedin: null, disabled: 0 },
        { id: 2, name: 'B', email: 'b@x.com', department: null, designation: null, created_on: '2026-01-01', last_loggedin: null, disabled: 1 },
      ])
    })

    const data = await mod.rolplayAppOrganization(37)
    expect(data.members.find(m => m.id === 1)!.status).toBe('active')
    expect(data.members.find(m => m.id === 2)!.status).toBe('disabled')
  })

  it('never selects or exposes the password column', async () => {
    const mod = await fresh()
    const sqlCalls: string[] = []
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      sqlCalls.push(body.sql)
      return respond([])
    })

    await mod.rolplayAppOrganization(37)
    for (const sql of sqlCalls) expect(sql.toLowerCase()).not.toContain('password')
  })

  it('is scoped to the right client id and never bounded by a date range', async () => {
    const mod = await fresh()
    const sqlCalls: string[] = []
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      sqlCalls.push(body.sql)
      return respond([])
    })

    await mod.rolplayAppOrganization(37)
    expect(sqlCalls).toHaveLength(2)
    for (const sql of sqlCalls) {
      expect(sql).toContain('client_id = 37')
      expect(sql).not.toContain('BETWEEN')
    }
  })

  it('returns no admins/supervisors -- rolplay-app has no such hierarchy', async () => {
    const mod = await fresh()
    fetchSpy.mockImplementation(async () => respond([]))
    const data = await mod.rolplayAppOrganization(37)
    expect(data.admins).toEqual([])
    expect(data.totalAdmins).toBe(0)
    expect(data.totalSupervisors).toBe(0)
  })
})
