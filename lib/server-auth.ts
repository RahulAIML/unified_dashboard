import type { NextRequest } from 'next/server'
import { verifyAccessToken } from './jwt'

export interface ApiAuthContext {
  userId: number
  email: string
  /** 0 means authenticated but not linked to an organization yet */
  customerId: number
}

export async function getAuthContextFromRequest(request: NextRequest): Promise<ApiAuthContext | null> {
  const token = request.cookies.get('accessToken')?.value ?? null
  if (!token) return null

  const claims = await verifyAccessToken(token)
  if (!claims) return null

  // Accept 0 (no org) — dashboard APIs return empty state for customer 0.
  // Only reject truly invalid values (NaN, negative, non-finite).
  const customerId = Number(claims.customer_id ?? 0)
  if (!Number.isFinite(customerId) || customerId < 0) return null

  return {
    userId: claims.user_id,
    email: claims.email,
    customerId,
  }
}
