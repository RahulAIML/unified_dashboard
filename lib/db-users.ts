/**
 * db-users.ts — User query functions via Bridge API
 */

import { User } from './auth'
import { query } from './db'

/**
 * Safe query wrapper — returns null on any error instead of throwing
 */
async function safeQuery<T>(sql: string, params: unknown[]): Promise<T | null> {
  try {
    const result = await query<T>(sql, params)
    return result as T
  } catch (error) {
    console.error('Database query error:', error)
    return null
  }
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const query = `
    SELECT
      id,
      email,
      full_name,
      company_domain,
      company_id,
      role,
      created_at
    FROM users
    WHERE email = ?
    LIMIT 1
  `

  const result = await safeQuery<User[]>(query, [email])
  return result && result.length > 0 ? result[0] : null
}

/**
 * Find user by ID
 */
export async function findUserById(userId: number): Promise<User | null> {
  const query = `
    SELECT
      id,
      email,
      full_name,
      company_domain,
      company_id,
      role,
      created_at
    FROM users
    WHERE id = ?
    LIMIT 1
  `

  const result = await safeQuery<User[]>(query, [userId])
  return result && result.length > 0 ? result[0] : null
}

/**
 * Create new user
 */
export async function createUser(
  email: string,
  passwordHash: string,
  fullName: string,
  companyDomain: string,
  companyId: string,
  role: 'user' | 'admin' = 'user'
): Promise<User | null> {
  const query = `
    INSERT INTO users (email, password_hash, full_name, company_domain, company_id, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
  `

  try {
    const result = await safeQuery<any>(query, [
      email,
      passwordHash,
      fullName,
      companyDomain,
      companyId,
      role,
    ])

    if (result && result.insertId) {
      return findUserById(result.insertId)
    }
    return null
  } catch (error) {
    console.error('Error creating user:', error)
    return null
  }
}

/**
 * Get password hash for user (for login verification)
 */
export async function getUserPasswordHash(email: string): Promise<string | null> {
  const query = `
    SELECT password_hash
    FROM users
    WHERE email = ?
    LIMIT 1
  `

  const result = await safeQuery<{ password_hash: string }[]>(query, [email])
  return result && result.length > 0 ? result[0].password_hash : null
}

/**
 * Update user last login timestamp
 */
export async function updateUserLastLogin(userId: number): Promise<boolean> {
  const query = `
    UPDATE users
    SET last_login = NOW(), updated_at = NOW()
    WHERE id = ?
  `

  try {
    await safeQuery<any>(query, [userId])
    return true
  } catch (error) {
    console.error('Error updating last login:', error)
    return false
  }
}

/**
 * Create session record (for token invalidation)
 */
export async function createSession(userId: number, tokenJti: string, expiresAt: Date): Promise<boolean> {
  const query = `
    INSERT INTO user_sessions (user_id, token_jti, expires_at, created_at)
    VALUES (?, ?, ?, NOW())
  `

  try {
    await safeQuery<any>(query, [userId, tokenJti, expiresAt])
    return true
  } catch (error) {
    console.error('Error creating session:', error)
    return false
  }
}

/**
 * Invalidate session (logout)
 */
export async function invalidateSession(tokenJti: string): Promise<boolean> {
  const query = `
    DELETE FROM user_sessions
    WHERE token_jti = ?
  `

  try {
    await safeQuery<any>(query, [tokenJti])
    return true
  } catch (error) {
    console.error('Error invalidating session:', error)
    return false
  }
}

/**
 * Check if session is valid
 */
export async function isSessionValid(tokenJti: string): Promise<boolean> {
  const query = `
    SELECT id
    FROM user_sessions
    WHERE token_jti = ? AND expires_at > NOW()
    LIMIT 1
  `

  const result = await safeQuery<{ id: number }[]>(query, [tokenJti])
  return !!(result && result.length > 0)
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<boolean> {
  const query = `
    DELETE FROM user_sessions
    WHERE expires_at < NOW()
  `

  try {
    await safeQuery<any>(query, [])
    return true
  } catch (error) {
    console.error('Error cleaning up expired sessions:', error)
    return false
  }
}

/**
 * Check if email already exists
 */
export async function emailExists(email: string): Promise<boolean> {
  const query = `
    SELECT id
    FROM users
    WHERE email = ?
    LIMIT 1
  `

  const result = await safeQuery<{ id: number }[]>(query, [email])
  return !!(result && result.length > 0)
}
