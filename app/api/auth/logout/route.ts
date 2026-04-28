/**
 * /api/auth/logout — User logout endpoint
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, extractTokenFromHeader } from '@/lib/auth'
import { invalidateSession } from '@/lib/db-users'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Extract token
    const authHeader = request.headers.get('authorization')
    let token = extractTokenFromHeader(authHeader)

    if (!token) {
      const cookieToken = request.cookies.get('accessToken')?.value
      token = cookieToken || null
    }

    if (!token) {
      return buildApiError('Unauthorized: No token provided', 401)
    }

    // Verify token
    const payload = verifyAccessToken(token)
    if (!payload) {
      return buildApiError('Unauthorized: Invalid token', 401)
    }

    // Invalidate session
    await invalidateSession(payload.jti)

    // Clear cookies
    const response = buildSuccess({ message: 'Logged out successfully' })
    response.cookies.delete('accessToken')
    response.cookies.delete('refreshToken')

    return response
  } catch (error) {
    console.error('Error during logout:', error)
    return buildApiError('Internal server error', 500)
  }
}
