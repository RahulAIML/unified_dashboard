/**
 * Regression: /api/dashboard/organization previously served ONLY orgType
 * 'pharma' -- every other org type (including 'rolplay-app', e.g. Chinoin's
 * 581 real registered accounts) got the hardcoded EMPTY response regardless
 * of what lib/bridge-rolplay-app.ts's rolplayAppOrganization could actually
 * return. This locks in the new rolplay-app branch alongside the existing
 * pharma one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/server-auth', () => ({ getAuthContextFromRequest: vi.fn() }))
vi.mock('@/lib/org-type', () => ({ resolveOrgType: vi.fn() }))
vi.mock('@/lib/pharma-tenant', () => ({ resolvePharmaTenantAccess: vi.fn() }))
vi.mock('@/lib/bridge-pharma-analytics', () => ({ pharmaDashboardOrganization: vi.fn() }))
vi.mock('@/lib/bridge-rolplay-app', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bridge-rolplay-app')>('@/lib/bridge-rolplay-app')
  return { ...actual, resolveRolplayAppAccess: vi.fn(), rolplayAppOrganization: vi.fn() }
})
vi.mock('@/lib/demo', () => ({ isDemoDataEnabled: vi.fn().mockReturnValue(false) }))
vi.mock('@/lib/demo/engine', () => ({ demoOrganization: vi.fn() }))

import { GET } from '../organization/route'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenantAccess } from '@/lib/pharma-tenant'
import { pharmaDashboardOrganization } from '@/lib/bridge-pharma-analytics'
import { resolveRolplayAppAccess, rolplayAppOrganization } from '@/lib/bridge-rolplay-app'

const makeReq = () => new NextRequest('http://localhost/api/dashboard/organization')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAuthContextFromRequest).mockResolvedValue({ email: 'u@chinoin.com', customerId: 0, userId: 1 })
})

describe('GET /api/dashboard/organization', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getAuthContextFromRequest).mockResolvedValue(null)
    expect((await GET(makeReq())).status).toBe(401)
  })

  it("returns the empty shape for orgType 'none'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('none')
    const body = await (await GET(makeReq())).json()
    expect(body.data).toEqual({ totalMembers: 0, totalAdmins: 0, totalSupervisors: 0, members: [], admins: [] })
  })

  it("calls pharmaDashboardOrganization for orgType 'pharma'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('pharma')
    vi.mocked(resolvePharmaTenantAccess).mockResolvedValue('sanfer')
    vi.mocked(pharmaDashboardOrganization).mockResolvedValue({
      totalMembers: 5, totalAdmins: 1, totalSupervisors: 1, members: [], admins: [],
    })
    const body = await (await GET(makeReq())).json()
    expect(body.data.totalMembers).toBe(5)
    expect(rolplayAppOrganization).not.toHaveBeenCalled()
  })

  it("calls rolplayAppOrganization for orgType 'rolplay-app'", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('rolplay-app')
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(37)
    vi.mocked(rolplayAppOrganization).mockResolvedValue({
      totalMembers: 581, totalAdmins: 0, totalSupervisors: 0,
      members: [{ id: 1, fullName: 'A', email: 'a@chinoin.com', designation: null, adminId: null, status: 'active', sessions: 0, modulesUsed: [] }],
      admins: [],
    })
    const body = await (await GET(makeReq())).json()
    expect(body.data.totalMembers).toBe(581)
    expect(pharmaDashboardOrganization).not.toHaveBeenCalled()
    expect(resolveRolplayAppAccess).toHaveBeenCalledWith('u@chinoin.com')
  })

  it("errors when orgType is 'rolplay-app' but the client id can't be resolved", async () => {
    vi.mocked(resolveOrgType).mockResolvedValue('rolplay-app')
    vi.mocked(resolveRolplayAppAccess).mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).not.toBe(200)
  })
})
