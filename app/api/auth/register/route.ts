/**
 * /api/auth/register — User registration
 *
 * Returns specific, actionable error messages for every failure mode.
 */

import { NextRequest } from 'next/server'
import { createUser, emailExists, DbError } from '@/lib/db-users'
import {
  hashPassword,
  generateAccessToken,
  generateRefreshToken,
  validateEmail,
  validatePasswordStrength,
} from '@/lib/auth'
import { detectCompanyFromEmail } from '@/lib/company-mapping'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // ── 1. Parse body ────────────────────────────────────────────────
    let body: { email?: string; password?: string; full_name?: string }
    try {
      body = await request.json()
    } catch {
      return buildApiError('Invalid JSON in request body', 400)
    }

    const { email, password, full_name } = body

    // ── 2. Validate required fields ──────────────────────────────────
    if (!full_name?.trim()) {
      return buildApiError('Full name is required', 400)
    }
    if (!email?.trim()) {
      return buildApiError('Email address is required', 400)
    }
    if (!password) {
      return buildApiError('Password is required', 400)
    }

    // ── 3. Validate email format ─────────────────────────────────────
    if (!validateEmail(email)) {
      return buildApiError('Invalid email format', 400)
    }

    // ── 4. Validate password strength ────────────────────────────────
    const pwd = validatePasswordStrength(password)
    if (!pwd.valid) {
      return buildApiError(pwd.errors.join('. '), 400)
    }

    // ── 5. Check duplicate email ─────────────────────────────────────
    try {
      const exists = await emailExists(email)
      if (exists) {
        return buildApiError('This email address is already registered. Please sign in instead.', 409)
      }
    } catch (err) {
      if (err instanceof DbError) {
        return buildApiError(friendlyDbError(err), dbStatusCode(err))
      }
      throw err
    }

    // ── 6. Detect company from email domain ──────────────────────────
    const companyDomain = email.split('@')[1]?.toLowerCase() ?? 'unknown'
    const companyId = detectCompanyFromEmail(email) ?? companyDomain.split('.')[0]

    // ── 7. Hash password ─────────────────────────────────────────────
    const passwordHash = await hashPassword(password)

    // ── 8. Create user in DB ─────────────────────────────────────────
    let user
    try {
      user = await createUser(
        email.toLowerCase().trim(),
        passwordHash,
        full_name.trim(),
        companyDomain,
        companyId
      )
    } catch (err) {
      if (err instanceof DbError) {
        return buildApiError(friendlyDbError(err), dbStatusCode(err))
      }
      throw err
    }

    // ── 9. Generate JWT tokens ───────────────────────────────────────
    const accessToken  = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user)

    // ── 10. Return success with cookies ─────────────────────────────
    const response = buildSuccess({
      user: {
        id:         user.id,
        email:      user.email,
        full_name:  user.full_name,
        company_id: user.company_id,
      },
      access_token:  accessToken,
      refresh_token: refreshToken,
    })

    const isProd = process.env.NODE_ENV === 'production'

    response.cookies.set('accessToken', accessToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'lax',
      maxAge:   15 * 60,           // 15 min
      path:     '/',
    })
    response.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60, // 7 days
      path:     '/',
    })

    return response

  } catch (error) {
    console.error('[/api/auth/register] Unhandled error:', error)
    const msg = error instanceof Error ? error.message : 'Unexpected error'
    return buildApiError(`Registration failed: ${msg}`, 500)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function friendlyDbError(err: DbError): string {
  switch (err.code) {
    case 'NOT_CONFIGURED':
      return 'The auth database is not configured. Add AUTH_DATABASE_URL to .env.local (see instructions in .env.local).'
    case 'TABLE_MISSING':
      return 'The auth database has not been initialised yet. Visit /api/auth/setup?secret=REDACTED_SETUP_SECRET to create the required tables, then try again.'
    case 'DUPLICATE_EMAIL':
      return 'This email address is already registered. Please sign in instead.'
    case 'CONNECTION_FAILED':
      return 'Cannot connect to the auth database. Check your AUTH_DATABASE_URL and try again.'
    default:
      return err.message
  }
}

function dbStatusCode(err: DbError): number {
  switch (err.code) {
    case 'DUPLICATE_EMAIL':  return 409
    case 'NOT_CONFIGURED':   return 503
    case 'TABLE_MISSING':    return 503
    case 'CONNECTION_FAILED': return 503
    default:                 return 500
  }
}
