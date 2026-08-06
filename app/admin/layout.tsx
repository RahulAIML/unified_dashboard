import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyAccessToken } from '@/lib/jwt'
import { findUserById } from '@/lib/db-users'

export const dynamic = 'force-dynamic'

/**
 * Server-side authorization boundary for every /admin/* route (tenants,
 * users, ...). Mirrors dashboard-builder/layout.tsx's pattern exactly.
 *
 * Before this file existed, /admin/tenants had no server-side gate at all --
 * only a client-side `isAdmin` check in the page component itself, so the
 * page shell rendered for any authenticated user regardless of role (the
 * underlying data was still safe: /api/admin/tenants checks
 * requireAdminFromRequest independently). A shared layout here closes that
 * for every current and future /admin/* route in one place, rather than
 * relying on each page remembering to gate itself.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get('accessToken')?.value
  const claims = token ? await verifyAccessToken(token) : null
  if (!claims) redirect('/auth/login')

  const user = await findUserById(claims.user_id).catch(() => null)
  if (!user || user.role !== 'admin') redirect('/')

  return children
}
