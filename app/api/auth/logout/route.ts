/**
 * /api/auth/logout — Logout
 *
 * Invalidates refresh session (when present) and clears auth cookies.
 */

import { NextRequest } from 'next/server'
import { verifyRefreshToken } from '@/lib/jwt'
import { invalidateSession } from '@/lib/db-users'
import { buildSuccess } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get('refreshToken')?.value ?? null
  if (refreshToken) {
    const claims = await verifyRefreshToken(refreshToken)
    if (claims?.jti) {
      await invalidateSession(claims.jti).catch(() => null)
    }
  }

  const response = buildSuccess({ message: 'Logged out successfully' })
  response.cookies.delete('accessToken')
  response.cookies.delete('refreshToken')
  return response
}

