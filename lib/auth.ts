/**
 * auth.ts — Core JWT and password hashing utilities
 */

import * as jwt from 'jsonwebtoken'
import * as bcrypt from 'bcryptjs'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod'
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev-refresh-secret-change-in-prod'
// 8 hours — long enough for a full work day without forced re-login.
// Refresh token (7 days) silently renews the access token when it expires.
const ACCESS_TOKEN_EXPIRY = '8h'
const REFRESH_TOKEN_EXPIRY = '7d'

export interface User {
  id: number
  email: string
  full_name: string
  company_domain: string
  company_id: string
  role: 'user' | 'admin'
  created_at: string
}

export interface TokenPayload {
  user_id: number
  email: string
  company_id: string
  iat: number
  exp: number
  jti: string
}

/**
 * Hash a password using bcryptjs
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

/**
 * Compare password with hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

/**
 * Generate access token (JWT)
 */
export function generateAccessToken(user: User): string {
  const jti = `${user.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    user_id: user.id,
    email: user.email,
    company_id: user.company_id,
    jti,
  }
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
    algorithm: 'HS256',
  })
}

/**
 * Generate refresh token
 */
export function generateRefreshToken(user: User): string {
  const jti = `refresh-${user.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const payload: Omit<TokenPayload, 'iat' | 'exp'> = {
    user_id: user.id,
    email: user.email,
    company_id: user.company_id,
    jti,
  }
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
    algorithm: 'HS256',
  })
}

/**
 * Verify and decode JWT token
 */
export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ['HS256'],
    })
    return decoded as TokenPayload
  } catch (error) {
    return null
  }
}

/**
 * Verify and decode refresh token
 */
export function verifyRefreshToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET, {
      algorithms: ['HS256'],
    })
    return decoded as TokenPayload
  } catch (error) {
    return null
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.slice(7) // Remove "Bearer " prefix
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain an uppercase letter')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain a lowercase letter')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain a number')
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push('Password must contain a special character')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}
