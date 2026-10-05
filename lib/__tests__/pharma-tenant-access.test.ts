/**
 * Tenant-isolation regression coverage for S1.
 *
 * Registration is open (no invite, no email verification) and pharma tenants
 * resolved on email DOMAIN alone, so anyone could sign up as
 * intruder@sanfer.com.mx and inherit Sanfer's entire dashboard. bridge-rolplay-app
 * had always guarded this by verifying the address exists in r_user; pharma had
 * no equivalent until resolvePharmaTenantAccess.
 *
 * Coverage is necessarily partial: only tenants with a roster endpoint
 * (hasOrganization -> org.members / list.members) can be checked at all. These
 * tests pin BOTH halves of that contract, so neither can regress silently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const pharmaDashboardOrganization = vi.fn()

vi.mock('@/lib/bridge-pharma-analytics', () => ({
  pharmaDashboardOrganization: (...a: unknown[]) => pharmaDashboardOrganization(...a),
}))

async function fresh() {
  vi.resetModules()
  // sanfer + apotex are the two built-in tenants with hasOrganization: true.
  // Their TENANT_CONFIG entries only exist when a bridge base URL is set.
  process.env.PHARMA_BRIDGE_BASE_URL = 'https://bridge.test'
  process.env.PHARMA_TENANT_DOMAINS = [
    'sanfer:sanfer.com.mx',
    'apotex:apotex.com',
    'heineken:heineken.com', // exceltis_rest -- no roster endpoint
  ].join(',')
  return import('../pharma-tenant')
}

function org(memberEmails: string[], adminEmails: string[] = []) {
  return {
    totalMembers: memberEmails.length,
    totalAdmins: adminEmails.length,
    totalSupervisors: 0,
    members: memberEmails.map((email, i) => ({ id: i, fullName: 'M', email, designation: null, adminId: null })),
    admins: adminEmails.map((email, i) => ({ id: i, fullName: 'A', email, profileType: 'admin' })),
  }
}

beforeEach(() => {
  pharmaDashboardOrganization.mockReset()
})
afterEach(() => {
  delete process.env.PHARMA_BRIDGE_BASE_URL
  delete process.env.PHARMA_TENANT_DOMAINS
})

describe('resolvePharmaTenantAccess — verifiable tenants', () => {
  it('grants a real member of the tenant', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockResolvedValue(org(['rep@sanfer.com.mx']))

    expect(await mod.resolvePharmaTenantAccess('rep@sanfer.com.mx')).toBe('sanfer')
  })

  it('DENIES a domain squatter who is not on the roster', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockResolvedValue(org(['rep@sanfer.com.mx']))

    // The domain still resolves the tenant -- that is exactly the trap.
    expect(await mod.resolvePharmaTenant('intruder@sanfer.com.mx')).toBe('sanfer')
    // ...but access must not be granted.
    expect(await mod.resolvePharmaTenantAccess('intruder@sanfer.com.mx')).toBeNull()
  })

  it('grants an admin listed only in the admins roster', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockResolvedValue(org([], ['boss@apotex.com']))

    expect(await mod.resolvePharmaTenantAccess('boss@apotex.com')).toBe('apotex')
  })

  it('matches case-insensitively and ignores surrounding whitespace', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockResolvedValue(org(['  Rep@Sanfer.com.MX ']))

    expect(await mod.resolvePharmaTenantAccess('rep@sanfer.com.mx')).toBe('sanfer')
  })

  it('caches the roster rather than re-fetching per request', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockResolvedValue(org(['rep@sanfer.com.mx']))

    await mod.resolvePharmaTenantAccess('rep@sanfer.com.mx')
    await mod.resolvePharmaTenantAccess('rep@sanfer.com.mx')

    expect(pharmaDashboardOrganization).toHaveBeenCalledTimes(1)
  })
})

describe('resolvePharmaTenantAccess — availability safeguards', () => {
  it('does not lock out a tenant when the roster bridge throws', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockRejectedValue(new Error('bridge unreachable'))

    // Failing closed here would take a whole tenant's dashboard down on a
    // transient upstream error.
    expect(await mod.resolvePharmaTenantAccess('rep@sanfer.com.mx')).toBe('sanfer')
  })

  it('does not treat an empty roster as "nobody is a member"', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockResolvedValue(org([]))

    expect(await mod.resolvePharmaTenantAccess('rep@sanfer.com.mx')).toBe('sanfer')
  })

  it('retries after a transient failure instead of caching the failure', async () => {
    const mod = await fresh()
    pharmaDashboardOrganization.mockRejectedValueOnce(new Error('boom'))
    pharmaDashboardOrganization.mockResolvedValue(org(['rep@sanfer.com.mx']))

    await mod.resolvePharmaTenantAccess('intruder@sanfer.com.mx') // allowed through on the error
    // Second call gets a real roster, so the squatter is now correctly denied.
    expect(await mod.resolvePharmaTenantAccess('intruder@sanfer.com.mx')).toBeNull()
  })
})

describe('resolvePharmaTenantAccess — unverifiable tenants', () => {
  it('passes through a tenant with no roster endpoint, without calling the bridge', async () => {
    const mod = await fresh()

    // Heineken is exceltis_rest: no hasOrganization, so nothing to check against.
    // Denying would lock out 100% of its real users to close a hole for zero.
    expect(await mod.resolvePharmaTenantAccess('anyone@heineken.com')).toBe('heineken')
    expect(pharmaDashboardOrganization).not.toHaveBeenCalled()
  })

  it('reports which tenants are actually verifiable', async () => {
    const mod = await fresh()

    expect(mod.pharmaMembershipVerifiable('sanfer')).toBe(true)
    expect(mod.pharmaMembershipVerifiable('apotex')).toBe(true)
    expect(mod.pharmaMembershipVerifiable('heineken')).toBe(false)
  })

  it('still returns null for an email on no known tenant domain', async () => {
    const mod = await fresh()

    expect(await mod.resolvePharmaTenantAccess('someone@unrelated.example')).toBeNull()
  })
})
