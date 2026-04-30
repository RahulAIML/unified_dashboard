/**
 * /api/auth/login — User login
 *
 * FINAL decisions:
 * - Resolve tenant (email → customer_id) ONLY during login via PHP bridge
 * - Store customer_id in JWT (HTTP-only cookies)
 * - Never use company_id or header propagation
 */

import { NextRequest } from 'next/server'
import {
  getUserPasswordHash,
  findUserByEmail,
  createSession,
  updateUserLastLogin,
  updateUserCustomerId,
  DbError,
} from '@/lib/db-users'
import { verifyPassword } from '@/lib/password'
import {
  signAccessToken,
  signRefreshToken,
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
} from '@/lib/jwt'
import { resolveCustomerIdByEmail } from '@/lib/bridge-client'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    let body: { email?: string; password?: string }
    try {
      body = await request.json()
    } catch {
      return buildApiError('Invalid JSON in request body', 400)
    }

    const email = body.email?.toLowerCase().trim() ?? ''
    const password = body.password ?? ''

    if (!email || !password) {
      return buildApiError('Email and password are required', 400)
    }

    let user
    let passwordHash: string | null
    try {
      user = await findUserByEmail(email)
      if (!user) return buildApiError('No account found with this email address.', 401)
      passwordHash = await getUserPasswordHash(email)
    } catch (err) {
      if (err instanceof DbError) {
        console.error('[/api/auth/login] DB error:', err.code, err.message)
        return buildApiError('We\'re unable to sign you in right now. Please try again in a few minutes.', 503)
      }
      throw err
    }

    if (!passwordHash) {
      return buildApiError('Account data is incomplete. Please contact support.', 500)
    }

    const passwordValid = await verifyPassword(password, passwordHash)
    if (!passwordValid) return buildApiError('Incorrect password. Please try again.', 401)

    // Resolve tenant ONCE at login
    const customerId = await resolveCustomerIdByEmail(email)
    if (!customerId) {
      return buildApiError('Your account is not provisioned for analytics access. Please contact support.', 403)
    }

    // Cache in auth DB so we don't resolve on every request
    if (user.customer_id !== customerId) {
      await updateUserCustomerId(user.id, customerId).catch(() => null)
      user = { ...user, customer_id: customerId }
    }

    const access = await signAccessToken({ user_id: user.id, email: user.email, customer_id: customerId })
    const refresh = await signRefreshToken({ user_id: user.id, email: user.email, customer_id: customerId })

    // Record refresh session for logout/refresh validation
    await createSession(user.id, refresh.jti, new Date(refresh.exp * 1000))
    await updateUserLastLogin(user.id)

    const response = buildSuccess({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        customer_id: customerId,
        role: user.role,
      },
    })

    const isProd = process.env.NODE_ENV === 'production'
    response.cookies.set('accessToken', access.token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
      path: '/',
    })
    response.cookies.set('refreshToken', refresh.token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[/api/auth/login] Unhandled error:', error)
    return buildApiError('Something went wrong. Please try again.', 500)
  }
}

