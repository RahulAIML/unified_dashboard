/**
 * /api/auth/refresh — Refresh access token
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyRefreshToken, generateAccessToken } from '@/lib/auth'
import { findUserById } from '@/lib/db-users'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Get refresh token from cookie
    const refreshToken = request.cookies.get('refreshToken')?.value

    if (!refreshToken) {
      return buildApiError('Unauthorized: No refresh token', 401)
    }

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken)
    if (!payload) {
      return buildApiError('Unauthorized: Invalid refresh token', 401)
    }

    // Get user details
    const user = await findUserById(payload.user_id)
    if (!user) {
      return buildApiError('User not found', 404)
    }

    // Generate new access token
    const newAccessToken = generateAccessToken(user)

    // Return response with new token in cookie
    const response = buildSuccess({
      access_token: newAccessToken,
    })

    response.cookies.set('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60, // 8 hours
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Error refreshing token:', error)
    return buildApiError('Internal server error', 500)
  }
}
