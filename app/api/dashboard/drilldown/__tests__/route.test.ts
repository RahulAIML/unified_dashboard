import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/data-provider', () => ({ getDrilldown: vi.fn() }))
vi.mock('@/lib/pharma-tenant', () => ({ resolvePharmaTenantAccess: vi.fn() }))
vi.mock('@/lib/bridge-pharma-analytics', () => ({ pharmaDashboardDrilldown: vi.fn() }))
vi.mock('@/lib/bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bridge-rolplay-app')>('@/lib/bridge-rolplay-app')
  return { ...actual, resolveRolplayAppAccess: vi.fn(), rolplayAppDrilldown: vi.fn() }
})
vi.mock('@/lib/demo', () => ({ isDemoDataEnabled: vi.fn().mockReturnValue(false) }))
vi.mock('@/lib/demo/reports', () => ({ getDemoReport: vi.fn() }))

import { GET } from '../[savedReportId]/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { getDrilldown } from '@/lib/data-provider'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardDrilldown } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppDrilldown } from '@/lib/bridge-rolplay-app'

const makeReq = (id: string) => new NextRequest(`http://localhost/api/dashboard/drilldown/${id}`)
const params = (id: string) => ({ params: Promise.resolve({ savedReportId: id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue({ email: 'u@siigo.com', customerId: 0, userId: 1 })
})

describe("GET /api/dashboard/drilldown/[savedReportId] — orgType 'rolplay-app'", () => {
  it('resolves the tenant, calls rolplayAppDrilldown with the resolved client id, and returns its data', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('rolplay-app')
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(29)
    vi.mocked(rolplayAppDrilldown).mockResolvedValue({
      savedReportId: 78, usecaseId: 3092, date: '2026-04-13', fields: [], closingJson: null,
    })

    const res = await GET(makeReq('78'), params('78'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(rolplayAppDrilldown).toHaveBeenCalledWith(78, 29)
    expect(body.data.savedReportId).toBe(78)
    // Must never fall through to the coach_app_sql path for this org type.
    expect(getDrilldown).not.toHaveBeenCalled()
    expect(pharmaDashboardDrilldown).not.toHaveBeenCalled()
  })

  it('returns 404 when the session id does not belong to this tenant (rolplayAppDrilldown returns null)', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('rolplay-app')
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(29)
    vi.mocked(rolplayAppDrilldown).mockResolvedValue(null)

    const res = await GET(makeReq('999'), params('999'))
    expect(res.status).toBe(404)
  })

  it('returns 500 without ever querying session data when the rolplay-app tenant cannot be resolved', async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('rolplay-app')
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(null)

    const res = await GET(makeReq('78'), params('78'))
    expect(res.status).toBe(500)
    expect(rolplayAppDrilldown).not.toHaveBeenCalled()
  })
})

describe('GET /api/dashboard/drilldown/[savedReportId] — other org types are unaffected', () => {
  it("still routes orgType 'analytics' through getDrilldown", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('analytics')
    vi.mocked(getDrilldown).mockResolvedValue({ savedReportId: 5, usecaseId: null, date: '2026-04-13', fields: [], closingJson: null })

    const res = await GET(makeReq('5'), params('5'))
    expect(res.status).toBe(200)
    expect(getDrilldown).toHaveBeenCalledWith(5, 0)
    expect(rolplayAppDrilldown).not.toHaveBeenCalled()
  })

  it("still routes orgType 'pharma' through pharmaDashboardDrilldown", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('pharma')
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue('sanfer')
    vi.mocked(pharmaDashboardDrilldown).mockResolvedValue({ savedReportId: 7, usecaseId: null, date: '2026-04-13', fields: [], closingJson: null })

    const res = await GET(makeReq('7'), params('7'))
    expect(res.status).toBe(200)
    expect(rolplayAppDrilldown).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-numeric id before resolving any org type', async () => {
    const res = await GET(makeReq('abc'), params('abc'))
    expect(res.status).toBe(400)
    expect(resolveOrgType).not.toHaveBeenCalled()
  })
})
