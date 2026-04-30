/**
 * /api/auth/refresh — Refresh access token
 *
 * Reads refresh token from HTTP-only cookie, validates session jti, and
 * issues a new access token cookie. Does NOT resolve tenant from bridge.
 */

import { NextRequest } from 'next/server'
import { verifyRefreshToken, signAccessToken, ACCESS_TOKEN_MAX_AGE_SECONDS } from '@/lib/jwt'
import { findUserById, isSessionValid } from '@/lib/db-users'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const refreshToken = request.cookies.get('refreshToken')?.value ?? null
    if (!refreshToken) return buildApiError('Unauthorized: No refresh token', 401)

    const claims = await verifyRefreshToken(refreshToken)
    if (!claims) return buildApiError('Unauthorized: Invalid refresh token', 401)

    const ok = await isSessionValid(claims.jti)
    if (!ok) return buildApiError('Unauthorized: Session expired', 401)

    const user = await findUserById(claims.user_id)
    if (!user) return buildApiError('User not found', 404)

    const access = await signAccessToken({
      user_id: user.id,
      email: user.email,
      customer_id: user.customer_id,
    })

    const response = buildSuccess({ ok: true })
    response.cookies.set('accessToken', access.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
      path: '/',
    })
    return response
  } catch (error) {
    console.error('[/api/auth/refresh] Unhandled error:', error)
    return buildApiError('Internal server error', 500)
  }
}

