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

/**
 * Returns the authenticated user's DB row only if role === 'admin'. Role
 * isn't in the JWT claims, so this does one extra lookup — acceptable since
 * admin routes are low-traffic. Returns null for unauthenticated OR
 * non-admin requests (caller doesn't need to distinguish the two).
 */
export async function requireAdminFromRequest(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return null
  const { findUserById } = await import('./db-users')
  const user = await findUserById(ctx.userId).catch(() => null)
  if (!user || user.role !== 'admin') return null
  return { ...ctx, role: user.role as 'admin' }
}
