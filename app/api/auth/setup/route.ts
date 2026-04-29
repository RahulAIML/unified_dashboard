/**
 * GET /api/auth/setup?secret=<SETUP_SECRET>
 *
 * Initialises the Auth PostgreSQL database by creating the users and
 * user_sessions tables (IF NOT EXISTS — safe to call multiple times).
 *
 * Run this ONCE after you have configured AUTH_DATABASE_URL in .env.local.
 *
 * Example:
 *   curl https://yourdomain.com/api/auth/setup?secret=REDACTED_SETUP_SECRET
 */

import { NextRequest, NextResponse } from 'next/server'
import { authExec, AuthDbError } from '@/lib/db-auth'

export const runtime = 'nodejs'

const SETUP_SECRET = process.env.SETUP_SECRET ?? 'REDACTED_SETUP_SECRET'

export async function GET(request: NextRequest) {
  // ── Authenticate the caller ─────────────────────────────────────────────────
  const secret = request.nextUrl.searchParams.get('secret')
  if (secret !== SETUP_SECRET) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing or invalid setup secret.',
        hint: 'Add ?secret=REDACTED_SETUP_SECRET to the URL (or set SETUP_SECRET in .env)',
      },
      { status: 401 }
    )
  }

  // ── Check AUTH_DATABASE_URL is configured ───────────────────────────────────
  if (!process.env.AUTH_DATABASE_URL) {
    return NextResponse.json(
      {
        success: false,
        error: 'AUTH_DATABASE_URL is not configured.',
        hint: [
          '1. Create a free PostgreSQL database at https://neon.tech (or Supabase/Railway)',
          '2. Copy the connection string (postgresql://user:pass@host/dbname)',
          '3. Add it to .env.local as: AUTH_DATABASE_URL=postgresql://...',
          '4. Restart the Next.js dev server',
          '5. Call this endpoint again',
        ],
      },
      { status: 503 }
    )
  }

  const results: Record<string, string> = {}

  // ── 1. Create users table ───────────────────────────────────────────────────
  try {
    await authExec(`
      CREATE TABLE IF NOT EXISTS users (
        id              SERIAL PRIMARY KEY,
        email           VARCHAR(255) UNIQUE NOT NULL,
        password_hash   VARCHAR(255) NOT NULL,
        full_name       VARCHAR(255) NOT NULL DEFAULT '',
        company_domain  VARCHAR(255) NOT NULL DEFAULT '',
        company_id      VARCHAR(100) NOT NULL DEFAULT 'custom',
        role            VARCHAR(20)  NOT NULL DEFAULT 'user'
                          CHECK (role IN ('user', 'admin')),
        is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
        last_login      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)
    results.users_table = 'created or already exists ✓'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    results.users_table = `FAILED: ${msg}`
  }

  // ── 2. Create indexes on users (idempotent) ─────────────────────────────────
  try {
    await authExec(`CREATE INDEX IF NOT EXISTS idx_users_email      ON users (email)`)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id)`)
    results.users_indexes = 'created or already exist ✓'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    results.users_indexes = `FAILED: ${msg}`
  }

  // ── 3. Create user_sessions table ──────────────────────────────────────────
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
    results.user_sessions_table = 'created or already exists ✓'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    results.user_sessions_table = `FAILED: ${msg}`
  }

  // ── 4. Create indexes on sessions ──────────────────────────────────────────
  try {
    await authExec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions (expires_at)`)
    await authExec(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions (user_id)`)
    results.sessions_indexes = 'created or already exist ✓'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    results.sessions_indexes = `FAILED: ${msg}`
  }

  // ── 5. Verify tables exist ──────────────────────────────────────────────────
  let verifiedTables: string[] = []
  try {
    const qr = await authExec(`
      SELECT table_name
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'user_sessions')
       ORDER BY table_name
    `)
    verifiedTables = qr.rows.map((r: Record<string, string>) => r.table_name)
  } catch {
    verifiedTables = ['could not verify']
  }

  const allGood = Object.values(results).every((r) => r.includes('✓'))

  return NextResponse.json(
    {
      success: allGood,
      steps:   results,
      tables_verified: verifiedTables,
      next_step: allGood
        ? 'Auth database is ready. You can now register and log in.'
        : 'Some steps failed. Check the errors above and your AUTH_DATABASE_URL.',
    },
    { status: allGood ? 200 : 500 }
  )
}
