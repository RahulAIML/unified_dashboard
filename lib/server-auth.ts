import type { NextRequest } from 'next/server'
import { extractTokenFromHeader, verifyAccessToken } from './jwt'

export interface ApiAuthContext {
  userId: number
  email: string
  customerId: number
}

export async function getAuthContextFromRequest(request: NextRequest): Promise<ApiAuthContext | null> {
  const authHeader = request.headers.get('authorization')
  let token = extractTokenFromHeader(authHeader)
  if (!token) token = request.cookies.get('accessToken')?.value ?? null
  if (!token) return null

  const claims = await verifyAccessToken(token)
  if (!claims) return null

  const customerId = Number(claims.customer_id)
  if (!Number.isFinite(customerId) || customerId <= 0) return null

  return {
    userId: claims.user_id,
    email: claims.email,
    customerId,
  }
}

