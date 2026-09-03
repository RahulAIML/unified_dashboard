/**
 * db-users.ts — User CRUD via the Auth PostgreSQL DB.
 *
 * All queries go to the separate auth PostgreSQL database (lib/db-auth.ts).
 * The analytics MySQL DB (lib/db.ts / PHP bridge) is NEVER touched here.
 *
 * Key differences from MySQL:
 *   - Parameters: $1, $2, … (not ?)
 *   - INSERT … RETURNING *  (no need to SELECT after insert)
 *   - Timestamps: TIMESTAMPTZ columns return Date objects
 *   - Auto-increment: SERIAL column named "id"
 */

import type { QueryResultRow } from 'pg'
import type { AuthUser } from './auth-types'
import { authQuery, AuthDbError } from './db-auth'

// Re-export so callers can import DbError from here (backward compat)
export { AuthDbError as DbError } from './db-auth'

/**
 * Every query below asks for `onboarding_completed_at`, a column added long
 * after `users` itself -- it only exists once someone re-runs
 * GET /api/auth/setup against that specific database (this project's schema
 * "migration" is a manual, idempotent endpoint call, not an automatic
 * runner -- see app/api/auth/setup/route.ts). A fresh deploy of this CODE
 * does not by itself add the column to an already-provisioned production
 * DB, so naively selecting it there throws ("column ... does not exist" ->
 * lib/db-auth.ts classifies this as AuthDbError) and previously took down
 * login/me/register entirely until an operator remembered to re-run setup.
 *
 * This wrapper retries once, stripping the column, so every one of those
 * routes keeps working exactly as before this feature shipped -- the tour
 * simply won't auto-show (rowToUser's `?? null` already treats a missing
 * field as "not toured yet") until the column is actually migrated in.
 */
async function authQueryOnboardingSafe<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  try {
    return await authQuery<T>(sql, params)
  } catch (err) {
    // lib/db-auth.ts collapses BOTH "relation users does not exist" and
    // "column onboarding_completed_at does not exist" into the same generic
    // TABLE_MISSING message (the real Postgres detail, which would have
    // named the column, is discarded there) -- so this can't distinguish
    // them by message text. Retrying with the column stripped is safe
    // either way: if the whole table really is missing, the retry fails
    // with that identical error (no infinite loop, same 503 as before this
    // feature existed); if only the column is missing, it now succeeds.
    if (err instanceof AuthDbError && err.code === 'TABLE_MISSING') {
      // Handles both bare "onboarding_completed_at" and a qualified
      // "target.onboarding_completed_at" (promoteFirstAdmin's RETURNING).
      const strippedSql = sql.replace(/,\s*(?:\w+\.)?onboarding_completed_at/gi, '')
      if (strippedSql !== sql) return await authQuery<T>(strippedSql, params)
    }
    throw err
  }
}

// ── Row shape from PostgreSQL ──────────────────────────────────────────────────

interface UserRow {
  id:             number
  email:          string
  full_name:      string
  company_domain: string
  customer_id:    number
  role:           'user' | 'admin'
  created_at:     Date | string
  is_active:      boolean
  last_login:     Date | string | null
  onboarding_completed_at: Date | string | null
}

function toIso(v: Date | string | null): string | null {
  if (v == null) return null
  return typeof v === 'string' ? v : v.toISOString()
}

function rowToUser(row: UserRow): AuthUser {
  return {
    id:             row.id,
    email:          row.email,
    full_name:      row.full_name,
    customer_id:    Number(row.customer_id),
    role:           row.role,
    created_at:     typeof row.created_at === 'string'
                      ? row.created_at
                      : row.created_at.toISOString(),
    onboarding_completed_at: toIso(row.onboarding_completed_at ?? null),
  }
}

// ── User queries ───────────────────────────────────────────────────────────────

/**
 * Find a user by email address.
 * Returns null if not found, throws AuthDbError on DB failure.
 */
export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const rows = await authQueryOnboardingSafe<UserRow>(
    `SELECT id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login, onboarding_completed_at
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email.toLowerCase().trim()]
  )
  return rows.length > 0 ? rowToUser(rows[0]) : null
}

/**
 * Find a user by their primary key.
 * Returns null if not found, throws AuthDbError on DB failure.
 */
export async function findUserById(userId: number): Promise<AuthUser | null> {
  const rows = await authQueryOnboardingSafe<UserRow>(
    `SELECT id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login, onboarding_completed_at
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  )
  return rows.length > 0 ? rowToUser(rows[0]) : null
}

/**
 * Marks the first-time guided tour dismissed (completed OR skipped -- both
 * cases behave identically: never auto-show again). Idempotent: calling it
 * again (e.g. after a replay from Settings) just refreshes the timestamp.
 */
export async function completeOnboarding(userId: number): Promise<void> {
  await authQuery(
    `UPDATE users SET onboarding_completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [userId]
  )
}

/**
 * Create a new user and return the fully-hydrated row.
 * Uses RETURNING * so no second SELECT is needed.
 */
export async function createUser(
  email:          string,
  passwordHash:   string,
  fullName:       string,
  companyDomain:  string,
  customerId:     number,
  role:           'user' | 'admin' = 'user'
): Promise<AuthUser> {
  const rows = await authQueryOnboardingSafe<UserRow>(
    `INSERT INTO users
       (email, password_hash, full_name, company_domain, customer_id, role, is_active, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
     RETURNING id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login, onboarding_completed_at`,
    [email.toLowerCase().trim(), passwordHash, fullName.trim(), companyDomain, customerId, role]
  )

  if (rows.length === 0) {
    throw new AuthDbError('INSERT succeeded but returned no row.', 'QUERY_FAILED')
  }

  return rowToUser(rows[0])
}

export async function updateUserCustomerId(userId: number, customerId: number): Promise<void> {
  await authQuery(
    `UPDATE users SET customer_id = $1, updated_at = NOW() WHERE id = $2`,
    [customerId, userId]
  )
}

/** Summary row for the admin user-management list. Never includes password_hash. */
export interface UserSummary {
  id: number
  email: string
  full_name: string
  customer_id: number
  role: 'user' | 'admin'
  is_active: boolean
  created_at: string
  last_login: string | null
}

function rowToSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    customer_id: Number(row.customer_id),
    role: row.role,
    is_active: row.is_active,
    created_at: typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    last_login: row.last_login == null
      ? null
      : typeof row.last_login === 'string' ? row.last_login : row.last_login.toISOString(),
  }
}

/** All users, for the admin user-management screen. Ordered newest first. */
export async function listUsers(): Promise<UserSummary[]> {
  const rows = await authQuery<UserRow>(
    `SELECT id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login
       FROM users
      ORDER BY created_at DESC`,
  )
  return rows.map(rowToSummary)
}

/**
 * Set an existing, active user's role. Returns null if no matching active
 * user exists, so the caller can distinguish "not found" from a DB error.
 *
 * Deliberately has NO "last admin" guard here — that safety belongs at the
 * route layer, which knows who the CALLER is and can refuse self-demotion.
 * This function is a plain, unconditional set, same shape as
 * updateUserCustomerId above.
 */
export async function setUserRole(email: string, role: 'user' | 'admin'): Promise<AuthUser | null> {
  const rows = await authQueryOnboardingSafe<UserRow>(
    `UPDATE users
        SET role = $2, updated_at = NOW()
      WHERE email = $1 AND is_active = TRUE
      RETURNING id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login, onboarding_completed_at`,
    [email.toLowerCase().trim(), role],
  )
  return rows.length > 0 ? rowToUser(rows[0]) : null
}

/**
 * Promote an existing user only when no administrator exists yet.
 * The advisory lock makes concurrent bootstrap attempts deterministic.
 */
export async function promoteFirstAdmin(email: string): Promise<AuthUser | null> {
  const rows = await authQueryOnboardingSafe<UserRow>(
    `WITH bootstrap_lock AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(4815162342)
     )
     UPDATE users AS target
        SET role = 'admin', updated_at = NOW()
       FROM bootstrap_lock
      WHERE target.email = $1
        AND target.is_active = TRUE
        AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin')
     RETURNING target.id, target.email, target.full_name, target.company_domain,
               target.customer_id, target.role, target.created_at, target.is_active,
               target.last_login, target.onboarding_completed_at`,
    [email.toLowerCase().trim()],
  )
  return rows.length > 0 ? rowToUser(rows[0]) : null
}

/**
 * Retrieve the bcrypt password hash for login verification.
 * Returns null if user does not exist.
 */
export async function getUserPasswordHash(email: string): Promise<string | null> {
  const rows = await authQuery<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE email = $1 LIMIT 1`,
    [email.toLowerCase().trim()]
  )
  return rows.length > 0 ? rows[0].password_hash : null
}

/**
 * Returns true if the email address is already registered.
 * Returns false (not an error) when the table doesn't exist yet.
 */
export async function emailExists(email: string): Promise<boolean> {
  try {
    const rows = await authQuery<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    )
    return Number(rows[0]?.cnt ?? 0) > 0
  } catch (err) {
    if (err instanceof AuthDbError && err.code === 'TABLE_MISSING') {
      return false // Table not created yet → email can't exist
    }
    throw err
  }
}

/**
 * Stamp last_login after a successful login.
 * Non-critical — swallows errors silently to keep login unblocked.
 */
export async function updateUserLastLogin(userId: number): Promise<void> {
  await authQuery(
    `UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1`,
    [userId]
  ).catch((err) => {
    console.warn('[db-users] updateUserLastLogin failed (non-critical):', err.message)
  })
}

// ── Session management ─────────────────────────────────────────────────────────

/**
 * Record a refresh-token session for later invalidation.
 * Non-critical — login proceeds even if this insert fails.
 */
export async function createSession(
  userId:    number,
  tokenJti:  string,
  expiresAt: Date
): Promise<void> {
  await authQuery(
    `INSERT INTO user_sessions (user_id, token_jti, expires_at, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (token_jti) DO NOTHING`,
    [userId, tokenJti, expiresAt]
  ).catch((err) => {
    console.warn('[db-users] createSession failed (non-critical):', err.message)
  })
}

/**
 * Remove session record on logout (token invalidation).
 * Non-critical — swallows errors.
 */
export async function invalidateSession(tokenJti: string): Promise<void> {
  await authQuery(
    `DELETE FROM user_sessions WHERE token_jti = $1`,
    [tokenJti]
  ).catch((err) => {
    console.warn('[db-users] invalidateSession failed (non-critical):', err.message)
  })
}

/**
 * Returns true if the session token is still valid (not expired / not deleted).
 * Falls back to true when the sessions table is missing (JWT-only validation).
 */
export async function isSessionValid(tokenJti: string): Promise<boolean> {
  try {
    const rows = await authQuery<{ id: number }>(
      `SELECT id FROM user_sessions
        WHERE token_jti = $1 AND expires_at > NOW()
        LIMIT 1`,
      [tokenJti]
    )
    return rows.length > 0
  } catch {
    return true // sessions table missing → fall back to JWT-only validation
  }
}
