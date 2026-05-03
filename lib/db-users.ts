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

import type { AuthUser } from './auth-types'
import { authQuery, AuthDbError } from './db-auth'

// Re-export so callers can import DbError from here (backward compat)
export { AuthDbError as DbError } from './db-auth'

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
  }
}

// ── User queries ───────────────────────────────────────────────────────────────

/**
 * Find a user by email address.
 * Returns null if not found, throws AuthDbError on DB failure.
 */
export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const rows = await authQuery<UserRow>(
    `SELECT id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login
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
  const rows = await authQuery<UserRow>(
    `SELECT id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [userId]
  )
  return rows.length > 0 ? rowToUser(rows[0]) : null
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
  const rows = await authQuery<UserRow>(
    `INSERT INTO users
       (email, password_hash, full_name, company_domain, customer_id, role, is_active, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW())
     RETURNING id, email, full_name, company_domain, customer_id, role, created_at, is_active, last_login`,
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
