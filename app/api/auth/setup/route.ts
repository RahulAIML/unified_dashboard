/**
 * GET /api/auth/setup with X-Setup-Secret: <SETUP_SECRET>
 *
 * Initialises (or upgrades) the Auth PostgreSQL database schema.
 *
 * Tables:
 * - users (auth) — includes customer_id (tenant)
 * - user_sessions — refresh token jti tracking
 * - branding_settings — per-customer branding
 * - tenant_integrations — per-customer external integrations (Second Brain)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authExec } from '@/lib/db-auth'

export const runtime = 'nodejs'

const SETUP_SECRET = process.env.SETUP_SECRET

export async function GET(request: NextRequest) {
  if (!SETUP_SECRET) {
    return NextResponse.json(
      {
        success: false,
        error: 'SETUP_SECRET is not configured.',
        hint: 'Set SETUP_SECRET in env and restart.',
      },
      { status: 503 }
    )
  }

  const secret = request.headers.get('x-setup-secret')
  if (secret !== SETUP_SECRET) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing or invalid setup secret.',
        hint: 'Send SETUP_SECRET in the X-Setup-Secret request header.',
      },
      { status: 401 }
    )
  }

  if (!process.env.AUTH_DATABASE_URL) {
    return NextResponse.json(
      {
        success: false,
        error: 'AUTH_DATABASE_URL is not configured.',
        hint: [
          '1. Create a PostgreSQL database (Neon/Supabase/Railway)',
          '2. Copy the connection string',
          '3. Set AUTH_DATABASE_URL in env and restart',
          '4. Call this endpoint again',
        ],
      },
      { status: 503 }
    )
  }

  const steps: Record<string, string> = {}

  try {
    await authExec(`
      CREATE TABLE IF NOT EXISTS users (
        id              SERIAL PRIMARY KEY,
        email           VARCHAR(255) UNIQUE NOT NULL,
        password_hash   VARCHAR(255) NOT NULL,
        full_name       VARCHAR(255) NOT NULL DEFAULT '',
        company_domain  VARCHAR(255) NOT NULL DEFAULT '',
        customer_id     INTEGER      NOT NULL DEFAULT 0,
        role            VARCHAR(20)  NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user', 'admin')),
        is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
        last_login      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)
    await authExec(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS customer_id INTEGER NOT NULL DEFAULT 0
    `)
    steps.users_table = 'created or already exists ✓'
  } catch (err) {
    steps.users_table = `FAILED: ${(err as Error).message}`
  }

  try {
    // First-time guided tour: NULL = not yet dismissed (completed or
    // skipped), so it auto-shows once. Backfill runs ONLY the very first
    // time this column is added (checked before the ALTER, since ADD COLUMN
    // IF NOT EXISTS is itself idempotent) -- an unconditional
    // "WHERE onboarding_completed_at IS NULL" backfill would incorrectly
    // re-stamp genuinely new users (who are also NULL) as already toured if
    // this endpoint is ever re-run later for an unrelated table.
    const existing = await authExec(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'onboarding_completed_at'
    `)
    const columnAlreadyExisted = existing.rows.length > 0
    await authExec(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ
    `)
    if (!columnAlreadyExisted) {
      // Every account that already exists at migration time has necessarily
      // "already used the platform" -- must not suddenly see the tour.
      await authExec(`UPDATE users SET onboarding_completed_at = NOW() WHERE onboarding_completed_at IS NULL`)
    }
    steps.onboarding_column = 'created or already exists ✓'
  } catch (err) {
    steps.onboarding_column = `FAILED: ${(err as Error).message}`
  }

  try {
    await authExec(`CREATE INDEX IF NOT EXISTS idx_users_email       ON users (email)`)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_users_customer_id ON users (customer_id)`)
    steps.users_indexes = 'created or already exist ✓'
  } catch (err) {
    steps.users_indexes = `FAILED: ${(err as Error).message}`
  }

  try {
    await authExec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_jti   VARCHAR(255) UNIQUE NOT NULL,
        expires_at  TIMESTAMPTZ  NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)
    steps.user_sessions_table = 'created or already exists ✓'
  } catch (err) {
    steps.user_sessions_table = `FAILED: ${(err as Error).message}`
  }

  try {
    await authExec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions (expires_at)`)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions (user_id)`)
    steps.sessions_indexes = 'created or already exist ✓'
  } catch (err) {
    steps.sessions_indexes = `FAILED: ${(err as Error).message}`
  }

  try {
    // customer_id is NOT unique: it's 0 for every non-coach tenant, and
    // lib/db-branding.ts keys rows by tenant_key (per-user or per-tenant-
    // domain), so many rows legitimately share customer_id=0. An earlier
    // version of this table had `customer_id INTEGER UNIQUE NOT NULL`, which
    // silently capped the WHOLE table at one branding row ever (see
    // migrations/008_branding_settings_bootstrap.sql) — the DROP CONSTRAINT
    // below clears that if this endpoint runs against a DB stuck in that
    // state instead of a fresh one.
    await authExec(`
      CREATE TABLE IF NOT EXISTS branding_settings (
        id              SERIAL PRIMARY KEY,
        customer_id     INTEGER NOT NULL DEFAULT 0,
        tenant_key      TEXT,
        logo_url        TEXT,
        primary_color   TEXT NOT NULL DEFAULT '#DC2626',
        secondary_color TEXT NOT NULL DEFAULT '#1F2937',
        accent_color    TEXT NOT NULL DEFAULT '#14B8A6',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await authExec(`ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_customer_id_key`)
    await authExec(`ALTER TABLE branding_settings ADD COLUMN IF NOT EXISTS tenant_key TEXT`)
    await authExec(`UPDATE branding_settings SET tenant_key = 'cust:' || customer_id WHERE tenant_key IS NULL`)
    await authExec(`ALTER TABLE branding_settings ALTER COLUMN tenant_key SET NOT NULL`)
    await authExec(`CREATE UNIQUE INDEX IF NOT EXISTS branding_settings_tenant_key_uidx ON branding_settings (tenant_key)`)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_branding_customer_id ON branding_settings (customer_id)`)
    steps.branding_table = 'created or already exists ✓'
  } catch (err) {
    steps.branding_table = `FAILED: ${(err as Error).message}`
  }

  try {
    await authExec(`
      CREATE TABLE IF NOT EXISTS tenant_integrations (
        id                     SERIAL PRIMARY KEY,
        customer_id            INTEGER UNIQUE NOT NULL,
        second_brain_admin_email TEXT,
        second_brain_api_token   TEXT,
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_integrations_customer_id ON tenant_integrations (customer_id)`)
    steps.integrations_table = 'created or already exists ✓'
  } catch (err) {
    steps.integrations_table = `FAILED: ${(err as Error).message}`
  }

  try {
    await authExec(`
      CREATE TABLE IF NOT EXISTS pharma_tenants (
        id                  SERIAL PRIMARY KEY,
        tenant_key          VARCHAR(100) UNIQUE NOT NULL,
        display_name        VARCHAR(255) NOT NULL,
        kind                VARCHAR(20)  NOT NULL
                              CHECK (kind IN ('sale_exercises', 'kpi', 'exceltis_rest')),
        url                 TEXT         NOT NULL,
        x_tenant            VARCHAR(100),
        ucids               JSONB        NOT NULL DEFAULT '[]',
        has_certification   BOOLEAN      NOT NULL DEFAULT FALSE,
        has_objections      BOOLEAN      NOT NULL DEFAULT FALSE,
        has_business_lines  BOOLEAN      NOT NULL DEFAULT FALSE,
        has_organization    BOOLEAN      NOT NULL DEFAULT FALSE,
        has_top_stats       BOOLEAN      NOT NULL DEFAULT FALSE,
        coach_activity_ids  JSONB,
        auth_header_name    VARCHAR(100),
        auth_header_value   TEXT,
        is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
        created_by          INTEGER REFERENCES users(id),
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_pharma_tenants_key ON pharma_tenants (tenant_key)`)
    steps.pharma_tenants_table = 'created or already exists ✓'
  } catch (err) {
    steps.pharma_tenants_table = `FAILED: ${(err as Error).message}`
  }

  try {
    await authExec(`
      CREATE TABLE IF NOT EXISTS pharma_tenant_domains (
        id          SERIAL PRIMARY KEY,
        domain      VARCHAR(255) UNIQUE NOT NULL,
        tenant_key  VARCHAR(100) NOT NULL REFERENCES pharma_tenants(tenant_key) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_pharma_tenant_domains_domain ON pharma_tenant_domains (domain)`)
    steps.pharma_tenant_domains_table = 'created or already exists ✓'
  } catch (err) {
    steps.pharma_tenant_domains_table = `FAILED: ${(err as Error).message}`
  }

  let verified: string[] = []
  try {
    const qr = await authExec(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'user_sessions', 'branding_settings', 'tenant_integrations', 'pharma_tenants', 'pharma_tenant_domains')
       ORDER BY table_name
    `)
    verified = qr.rows.map((r: Record<string, string>) => r.table_name)
  } catch {
    verified = ['could not verify']
  }

  const ok = Object.values(steps).every((s) => s.includes('✓'))
  return NextResponse.json(
    {
      success: ok,
      steps,
      tables_verified: verified,
      next_step: ok ? 'Auth database is ready.' : 'Some steps failed. Check the errors above.',
    },
    { status: ok ? 200 : 500 }
  )
}

