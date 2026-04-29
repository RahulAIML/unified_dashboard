/**
 * /api/auth/login — User login
 *
 * Returns specific, actionable error messages for every failure mode.
 */

import { NextRequest } from 'next/server'
import {
  getUserPasswordHash,
  findUserByEmail,
  createSession,
  updateUserLastLogin,
  DbError,
} from '@/lib/db-users'
import { verifyPassword, generateAccessToken, generateRefreshToken } from '@/lib/auth'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // ── 1. Parse body ────────────────────────────────────────────────
    let body: { email?: string; password?: string }
    try {
      body = await request.json()
    } catch {
      return buildApiError('Invalid JSON in request body', 400)
    }

    const { email, password } = body

    if (!email?.trim() || !password) {
      return buildApiError('Email and password are required', 400)
    }

    // ── 2. Look up user ──────────────────────────────────────────────
    let user
    let passwordHash
    try {
      user = await findUserByEmail(email.toLowerCase().trim())
      if (!user) {
        return buildApiError('No account found with this email address.', 401)
      }
      passwordHash = await getUserPasswordHash(email.toLowerCase().trim())
    } catch (err) {
      if (err instanceof DbError) {
        console.error('[/api/auth/login] DB error:', err.code, err.message)
        switch (err.code) {
          case 'NOT_CONFIGURED':
          case 'TABLE_MISSING':
          case 'CONNECTION_FAILED':
            return buildApiError('We\'re unable to sign you in right now. Please try again in a few minutes.', 503)
          default:
            return buildApiError('Something went wrong. Please try again.', 500)
        }
      }
      throw err
    }

    if (!passwordHash) {
      return buildApiError('Account data is incomplete. Please contact support.', 500)
    }

    // ── 3. Verify password ───────────────────────────────────────────
    const passwordValid = await verifyPassword(password, passwordHash)
    if (!passwordValid) {
      return buildApiError('Incorrect password. Please try again.', 401)
    }

    // ── 4. Generate JWT tokens ───────────────────────────────────────
    const accessToken  = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user)

    // ── 5. Record session (non-blocking) ─────────────────────────────
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await createSession(user.id, `refresh-${user.id}-${Date.now()}`, expiresAt)
    await updateUserLastLogin(user.id)

    // ── 6. Return success with cookies ───────────────────────────────
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
      maxAge:   15 * 60,
      path:     '/',
    })
    response.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: 'lax',
      maxAge:   7 * 24 * 60 * 60,
      path:     '/',
    })

    return response

  } catch (error) {
    console.error('[/api/auth/login] Unhandled error:', error)
    return buildApiError('Something went wrong. Please try again.', 500)
  }
}
