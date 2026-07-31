/**
 * Regression test for the branding_settings bootstrap.
 *
 * Found live in production, 2026-07-31: PUT /api/branding 500'd with "Auth
 * database schema not initialised" — branding_settings had never been
 * created, because no numbered migration creates it (only 004 ALTERs it,
 * assuming /api/auth/setup was already called once). Separately, the
 * table's original definition here had `customer_id INTEGER UNIQUE NOT
 * NULL` — customer_id is 0 for every non-coach tenant AND every per-user
 * personalization row (lib/db-branding.ts), so that constraint capped the
 * WHOLE table at one branding row ever, across every tenant and every user.
 *
 * These tests pin: (1) this endpoint issues a DROP of that stale
 * constraint so a DB stuck in the old state self-heals, (2) the fresh
 * CREATE TABLE no longer reintroduces a UNIQUE constraint on customer_id,
 * and (3) tenant_key ends up backfilled and uniquely indexed either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const calls: string[] = []
vi.mock('@/lib/db-auth', () => ({
  authExec: vi.fn(async (sql: string) => {
    calls.push(sql)
    return { rows: [], rowCount: 0 }
  }),
}))

function req() {
  return new NextRequest('http://localhost/api/auth/setup', {
    headers: { 'x-setup-secret': 'test-secret' },
  })
}

beforeEach(() => {
  calls.length = 0
  vi.resetModules()
  process.env.SETUP_SECRET = 'test-secret'
  process.env.AUTH_DATABASE_URL = 'postgres://fake'
})

describe('GET /api/auth/setup — branding_settings bootstrap', () => {
  it('creates branding_settings without a UNIQUE constraint on customer_id', async () => {
    const { GET } = await import('../route')
    await GET(req())

    const createTable = calls.find(sql => /CREATE TABLE IF NOT EXISTS branding_settings/.test(sql))
    expect(createTable).toBeDefined()
    expect(createTable).not.toMatch(/customer_id\s+INTEGER\s+UNIQUE/i)
  })

  it('drops the legacy customer_id unique constraint if present', async () => {
    const { GET } = await import('../route')
    await GET(req())

    expect(calls.some(sql =>
      /ALTER TABLE branding_settings/.test(sql) &&
      /DROP CONSTRAINT IF EXISTS branding_settings_customer_id_key/.test(sql)
    )).toBe(true)
  })

  it('backfills tenant_key and uniquely indexes it, not customer_id', async () => {
    const { GET } = await import('../route')
    await GET(req())

    expect(calls.some(sql => /ADD COLUMN IF NOT EXISTS tenant_key/.test(sql))).toBe(true)
    expect(calls.some(sql => /UPDATE branding_settings SET tenant_key/.test(sql))).toBe(true)
    expect(calls.some(sql =>
      /CREATE UNIQUE INDEX IF NOT EXISTS branding_settings_tenant_key_uidx/.test(sql) &&
      /ON branding_settings \(tenant_key\)/.test(sql)
    )).toBe(true)
  })

  it('reports the branding step as a success once all statements run', async () => {
    const { GET } = await import('../route')
    const res = await GET(req())
    const json = await res.json()
    expect(json.steps.branding_table).toMatch(/✓/)
  })
})
