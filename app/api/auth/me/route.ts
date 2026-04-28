/**
 * /api/auth/me — Get current authenticated user
 */

import { NextRequest } from 'next/server'
import { verifyAccessToken, extractTokenFromHeader } from '@/lib/auth'
import { findUserById } from '@/lib/db-users'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // Extract token from Authorization header or cookie
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

    // Get user details
    const user = await findUserById(payload.user_id)
    if (!user) {
      return buildApiError('User not found', 404)
    }

    return buildSuccess({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        company_id: user.company_id,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Error getting current user:', error)
    return buildApiError('Internal server error', 500)
  }
}
