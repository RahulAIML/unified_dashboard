/**
 * /api/auth/me — Get current authenticated user
 *
 * Uses accessToken cookie and returns the user.
 * If auth DB is unavailable, falls back to JWT claims.
 */

import { NextRequest } from 'next/server'
import { verifyAccessToken } from '@/lib/jwt'
import { findUserById, DbError } from '@/lib/db-users'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('accessToken')?.value ?? null
    if (!token) return buildApiError('No authentication token found', 401)

    const claims = await verifyAccessToken(token)
    if (!claims) return buildApiError('Token is invalid or expired', 401)

    try {
      const user = await findUserById(claims.user_id)
      if (user) {
        return buildSuccess({
          user: {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            // Session tenant is authoritative (from JWT); do not trust auth DB here.
            customer_id: Number(claims.customer_id ?? 0),
            role: user.role,
          },
        })
      }
    } catch (err) {
      if (err instanceof DbError) {
        console.warn('[/api/auth/me] DB unavailable, using JWT claims:', err.code)
      } else {
        throw err
      }
    }

    return buildSuccess({
      user: {
        id: claims.user_id,
        email: claims.email,
        full_name: claims.email.split('@')[0],
        customer_id: Number(claims.customer_id),
        role: 'user' as const,
      },
    })
  } catch (error) {
    console.error('[/api/auth/me] Unhandled error:', error)
    return buildApiError('Authentication check failed', 500)
  }
}
