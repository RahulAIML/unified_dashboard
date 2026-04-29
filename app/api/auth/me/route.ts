/**
 * /api/auth/me — Get current authenticated user
 *
 * Resilient: if the DB is unavailable, falls back to JWT payload data
 * so users with valid tokens aren't locked out.
 */

import { NextRequest } from 'next/server'
import { verifyAccessToken, extractTokenFromHeader } from '@/lib/auth'
import { findUserById, DbError } from '@/lib/db-users'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    // ── Extract token from cookie or Authorization header ─────────
    const authHeader = request.headers.get('authorization')
    let token = extractTokenFromHeader(authHeader)

    if (!token) {
      token = request.cookies.get('accessToken')?.value ?? null
    }

    if (!token) {
      return buildApiError('No authentication token found', 401)
    }

    // ── Verify JWT signature and expiry ───────────────────────────
    const payload = verifyAccessToken(token)
    if (!payload) {
      return buildApiError('Token is invalid or expired', 401)
    }

    // ── Try to load fresh user data from DB ───────────────────────
    try {
      const user = await findUserById(payload.user_id)
      if (user) {
        return buildSuccess({
          user: {
            id:         user.id,
            email:      user.email,
            full_name:  user.full_name,
            company_id: user.company_id,
            role:       user.role,
          },
        })
      }
    } catch (err) {
      if (err instanceof DbError) {
        // DB is unavailable — fall through to JWT-payload fallback
        console.warn('[/api/auth/me] DB unavailable, using JWT payload:', err.code)
      } else {
        throw err
      }
    }

    // ── Fallback: return data from JWT payload (DB unavailable) ───
    // This keeps the user authenticated even when the DB is temporarily down.
    return buildSuccess({
      user: {
        id:         payload.user_id,
        email:      payload.email,
        full_name:  payload.email.split('@')[0], // best effort
        company_id: payload.company_id,
        role:       'user' as const,
      },
    })

  } catch (error) {
    console.error('[/api/auth/me] Unhandled error:', error)
    return buildApiError('Authentication check failed', 500)
  }
}
