/**
 * GET /api/auth/setup?secret=<SETUP_SECRET>
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

  const secret = request.nextUrl.searchParams.get('secret')
  if (secret !== SETUP_SECRET) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing or invalid setup secret.',
        hint: 'Add ?secret=<SETUP_SECRET> to the URL (or set SETUP_SECRET in env)',
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
    await authExec(`
      CREATE TABLE IF NOT EXISTS branding_settings (
        id              SERIAL PRIMARY KEY,
        customer_id     INTEGER UNIQUE NOT NULL,
        logo_url        TEXT,
        primary_color   TEXT NOT NULL DEFAULT '#DC2626',
        secondary_color TEXT NOT NULL DEFAULT '#1F2937',
        accent_color    TEXT NOT NULL DEFAULT '#14B8A6',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
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

  let verified: string[] = []
  try {
    const qr = await authExec(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'user_sessions', 'branding_settings', 'tenant_integrations')
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

