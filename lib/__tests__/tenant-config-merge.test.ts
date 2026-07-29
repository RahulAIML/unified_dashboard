/**
 * A DB row must never DROP a built-in tenant's verified capability flags.
 *
 * loadDynamicTenants() REBUILDS TENANT_CONFIG[key] from the pharma_tenants row,
 * so every flag has to be explicitly carried across. Flags that exist only in
 * static config — `hasLms` and `hasSimulator` have no DB column (migrations/003)
 * — are the easy ones to forget, and forgetting one is silent: Apotex simply
 * stops showing its LMS tab with no error anywhere.
 *
 * This regression test exists because that exact bug shipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** A row seeded WITHOUT capability flags — the clobbering case. */
function apotexRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantKey: 'apotex',
    displayName: 'Apotex',
    kind: 'kpi' as const,
    url: 'https://bridge.example.com/apotex/bridge/',
    xTenant: 'apotex',
    ucids: [],
    hasCertification: false,
    hasObjections: false,
    hasBusinessLines: false,
    hasOrganization: false,
    hasTopStats: false,
    coachActivityIds: null,
    authHeaderName: null,
    authHeaderValue: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

async function loadWithDbRows(rows: unknown[]) {
  vi.resetModules()
  process.env.PHARMA_BRIDGE_BASE_URL = 'https://bridge.example.com'
  process.env.PHARMA_TENANT_DOMAINS = 'apotex:apotex.com'

  vi.doMock('../db-tenants', () => ({
    listActiveTenants: vi.fn(async () => rows),
    listActiveDomainMappings: vi.fn(async () => [{ domain: 'apotex.com', tenantKey: 'apotex' }]),
  }))

  const mod = await import('../pharma-tenant')
  // resolvePharmaTenant() is what triggers the dynamic load + merge.
  await mod.resolvePharmaTenant('rep@apotex.com')
  return mod
}

beforeEach(() => {
  vi.resetModules()
})

describe('TENANT_CONFIG merge with a DB row', () => {
  it('keeps hasLms on a built-in tenant whose DB row has no LMS column', async () => {
    const { TENANT_CONFIG } = await loadWithDbRows([apotexRow()])

    // The whole point: Apotex's LMS tab depends on this surviving the merge.
    expect(TENANT_CONFIG.apotex?.hasLms).toBe(true)
  })

  it('leaves hasSimulator enabled (undefined reads as on)', async () => {
    const { TENANT_CONFIG } = await loadWithDbRows([apotexRow()])

    // The gate is `hasSimulator !== false`, so undefined must stay undefined
    // rather than being coerced to false.
    expect(TENANT_CONFIG.apotex?.hasSimulator).not.toBe(false)
  })

  it('does not drop other verified flags either', async () => {
    const { TENANT_CONFIG } = await loadWithDbRows([apotexRow()])

    // hasOrganization is verified live for Apotex and the DB row says false.
    expect(TENANT_CONFIG.apotex?.hasOrganization).toBe(true)
    expect(TENANT_CONFIG.apotex?.coachActivityIds).toEqual([8, 9, 10])
  })

  it('still lets the DB ENABLE a capability the static config lacks', async () => {
    const { TENANT_CONFIG } = await loadWithDbRows([
      apotexRow({ hasObjections: true }),
    ])

    // The merge must be one-way (never drops), not frozen.
    expect(TENANT_CONFIG.apotex?.hasObjections).toBe(true)
  })

  it('gives a brand-new self-service tenant no LMS by default', async () => {
    const { TENANT_CONFIG } = await loadWithDbRows([
      apotexRow({ tenantKey: 'newclient', displayName: 'New Client', xTenant: 'newclient' }),
    ])

    // No static config to inherit from — an LMS must be opted into, never assumed.
    expect(TENANT_CONFIG.newclient?.hasLms).toBeFalsy()
  })
})
