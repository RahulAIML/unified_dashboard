/**
 * Structural guards on the tenant upsert.
 *
 * Adding columns means renumbering every $N placeholder after the insertion
 * point — an off-by-one there is invisible to TypeScript and would silently
 * write values into the WRONG columns (a URL into an auth header, a boolean into
 * a jsonb field). These tests check the SQL and the parameter array agree, and
 * that the tri-state flags keep their three states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const authQuery = vi.fn()
vi.mock('../db-auth', () => ({
  authQuery: (...a: unknown[]) => authQuery(...a),
  AuthDbError: class extends Error {},
}))

function row(over: Record<string, unknown> = {}) {
  return {
    tenant_key: 't', display_name: 'T', kind: 'kpi', url: 'https://x/', x_tenant: 't',
    ucids: [], has_certification: false, has_objections: false, has_business_lines: false,
    has_organization: false, has_top_stats: false, has_lms: null, has_simulator: null,
    coach_activity_ids: null, auth_header_name: null, auth_header_value: null,
    is_active: true, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

async function load() {
  vi.resetModules()
  return import('../db-tenants')
}

const base = {
  tenantKey: 'acme', displayName: 'Acme', kind: 'kpi' as const,
  url: 'https://bridge/acme/', ucids: [],
}

beforeEach(() => {
  authQuery.mockReset()
  authQuery.mockResolvedValue([row()])
})

/** The SQL and params of the last authQuery call. */
function lastCall(): { sql: string; params: unknown[] } {
  const [sql, params] = authQuery.mock.calls.at(-1) as [string, unknown[]]
  return { sql, params }
}

describe('placeholder/parameter alignment', () => {
  it('uses exactly as many placeholders as parameters', async () => {
    const { upsertTenant } = await load()
    await upsertTenant({ ...base })

    const { sql, params } = lastCall()
    const nums = [...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]))
    const highest = Math.max(...nums)

    // If these diverge, values are landing in the wrong columns.
    expect(highest).toBe(params.length)
  })

  it('leaves no gap in the placeholder sequence', async () => {
    const { upsertTenant } = await load()
    await upsertTenant({ ...base })

    const { sql, params } = lastCall()
    const used = new Set([...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])))
    for (let i = 1; i <= params.length; i++) {
      // A skipped number means a parameter is silently unused.
      expect(used.has(i), `placeholder $${i} is missing`).toBe(true)
    }
  })

  it('writes the tenant key into the first position, lowercased', async () => {
    const { upsertTenant } = await load()
    await upsertTenant({ ...base, tenantKey: '  ACME  ' })

    expect(lastCall().params[0]).toBe('acme')
  })
})

describe('tri-state capability flags', () => {
  it('stores NULL when has_lms / has_simulator are omitted', async () => {
    const { upsertTenant } = await load()
    await upsertTenant({ ...base })

    const { params } = lastCall()
    // Positions 12 and 13 (1-indexed) → indexes 11 and 12.
    expect(params[11]).toBeNull()
    expect(params[12]).toBeNull()
  })

  it('stores false distinctly from unspecified', async () => {
    const { upsertTenant } = await load()
    await upsertTenant({ ...base, hasSimulator: false, hasLms: true })

    const { params } = lastCall()
    expect(params[11]).toBe(true)
    // false must survive as false, not collapse to null/unspecified — otherwise
    // an LMS-only client cannot switch the Simulator tab off.
    expect(params[12]).toBe(false)
  })

  it('COALESCEs on conflict so a partial update cannot wipe a set value', async () => {
    const { upsertTenant } = await load()
    await upsertTenant({ ...base })

    const { sql } = lastCall()
    expect(sql).toMatch(/has_lms\s*=\s*COALESCE\(EXCLUDED\.has_lms,\s*pharma_tenants\.has_lms\)/)
    expect(sql).toMatch(/has_simulator\s*=\s*COALESCE\(/)
  })

  it('does NOT COALESCE the plain boolean flags', async () => {
    const { upsertTenant } = await load()
    await upsertTenant({ ...base })

    const { sql } = lastCall()
    // These are NOT NULL with a false default; COALESCE would make them
    // impossible to turn back off.
    expect(sql).toMatch(/has_certification\s*=\s*EXCLUDED\.has_certification/)
  })
})

describe('read path', () => {
  it('maps a missing column to null rather than throwing', async () => {
    const { getTenantRow } = await load()
    // Pre-migration database: has_lms / has_simulator absent from the row.
    const partial = row()
    delete (partial as Record<string, unknown>).has_lms
    delete (partial as Record<string, unknown>).has_simulator
    authQuery.mockResolvedValue([partial])

    const t = await getTenantRow('t')

    expect(t?.hasLms).toBeNull()
    expect(t?.hasSimulator).toBeNull()
  })

  it('selects the new columns', async () => {
    const { getTenantRow } = await load()
    await getTenantRow('t')

    const { sql } = lastCall()
    expect(sql).toContain('has_lms')
    expect(sql).toContain('has_simulator')
  })
})
