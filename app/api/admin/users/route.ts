/**
 * GET   /api/admin/users — list every user (id, email, role, active, last_login).
 * PATCH /api/admin/users — set a user's role ('user' | 'admin').
 *
 * Admin-only. This is the endpoint that should have existed alongside
 * bootstrap-admin from the start: bootstrap-admin promotes exactly ONE user,
 * ever, and after that the only way to add a second admin was a raw SQL
 * UPDATE against production — which is how the first real admin account on
 * this deployment (buddhadeb@rolplay.ca) had to be promoted. This route
 * makes every promotion after that one a normal, audited, admin-gated API
 * call instead of a database console session.
 */

import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { listUsers, setUserRole } from '@/lib/db-users'
import { validateEmail } from '@/lib/password'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  const users = await listUsers()
  return buildSuccess({ users })
}

export async function PATCH(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  // Rate limited per admin, not per IP: this mutates account privilege, and
  // the existing admin/credentials write route uses the same 30/min budget.
  const limit = rateLimit(`admin-users:${admin.email}`, 30, 60_000)
  if (!limit.ok) {
    return buildApiError('Rate limit exceeded', 429, { retryAfterSeconds: limit.retryAfter })
  }

  let body: { email?: unknown; role?: unknown }
  try {
    body = await request.json()
  } catch {
    return buildApiError('Invalid JSON in request body', 400)
  }

  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const role = body.role

  if (!validateEmail(email)) return buildApiError('A valid email address is required', 400)
  if (role !== 'user' && role !== 'admin') {
    return buildApiError("role must be 'user' or 'admin'", 400)
  }

  // Refuse self-demotion. Not a hard lockout risk — promoteFirstAdmin()
  // becomes callable again the moment zero admins remain — but an admin
  // accidentally clicking "demote" on their own row mid-session is exactly
  // the kind of mistake worth blocking outright rather than relying on that
  // recovery path.
  if (role === 'user' && email === admin.email.toLowerCase().trim()) {
    return buildApiError('You cannot remove your own admin role', 400)
  }

  try {
    const updated = await setUserRole(email, role)
    if (!updated) {
      return buildApiError(`No active user found with email '${email}'`, 404)
    }

    console.info(`[audit] admin-users-role admin=${admin.email} target=${email} role=${role}`)

    return buildSuccess({ user: updated })
  } catch (err) {
    console.error('[/api/admin/users PATCH]', err)
    return buildApiError('Failed to update user role', 500)
  }
}
