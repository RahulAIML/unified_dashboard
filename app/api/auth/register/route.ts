/**
 * /api/auth/register — User registration
 *
 * FINAL decisions:
 * - Resolve tenant (email → customer_id) ONLY during registration/login via PHP bridge
 * - Store customer_id in JWT (HTTP-only cookies)
 * - Never use company_id string mapping
 */

import { NextRequest } from 'next/server'
import { createUser, emailExists, createSession, DbError } from '@/lib/db-users'
import { hashPassword, validateEmail, validatePasswordStrength } from '@/lib/password'
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
    let body: { email?: string; password?: string; full_name?: string }
    try {
      body = await request.json()
    } catch {
      return buildApiError('Invalid JSON in request body', 400)
    }

    const fullName = body.full_name?.trim() ?? ''
    const email = body.email?.toLowerCase().trim() ?? ''
    const password = body.password ?? ''

    if (!fullName) return buildApiError('Full name is required', 400)
    if (!email) return buildApiError('Email address is required', 400)
    if (!password) return buildApiError('Password is required', 400)
    if (!validateEmail(email)) return buildApiError('Invalid email format', 400)

    const pwd = validatePasswordStrength(password)
    if (!pwd.valid) return buildApiError(pwd.errors.join('. '), 400)

    const alreadyExists = await emailExists(email)
    if (alreadyExists) {
      return buildApiError('An account with this email already exists. Please sign in instead.', 409)
    }

    const customerId = await resolveCustomerIdByEmail(email)
    if (!customerId) {
      return buildApiError('User not linked to any organization', 403)
    }

    const companyDomain = email.split('@')[1]?.toLowerCase() ?? ''
    const passwordHash = await hashPassword(password)

    let user
    try {
      user = await createUser(email, passwordHash, fullName, companyDomain, customerId)
    } catch (err) {
      if (err instanceof DbError) {
        console.error('[/api/auth/register] DB error:', err.code, err.message)
        return buildApiError('We\'re unable to create your account right now. Please try again in a few minutes.', 503)
      }
      throw err
    }

    const access = await signAccessToken({ user_id: user.id, email: user.email, customer_id: customerId })
    const refresh = await signRefreshToken({ user_id: user.id, email: user.email, customer_id: customerId })

    await createSession(user.id, refresh.jti, new Date(refresh.exp * 1000))

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
    console.error('[/api/auth/register] Unhandled error:', error)
    return buildApiError('Something went wrong. Please try again.', 500)
  }
}
