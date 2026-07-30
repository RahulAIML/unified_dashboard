import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyAccessToken } from '@/lib/jwt'
import { findUserById } from '@/lib/db-users'

export const dynamic = 'force-dynamic'

/** Server-side authorization boundary for the administrative builder. */
export default async function DashboardBuilderLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get('accessToken')?.value
  const claims = token ? await verifyAccessToken(token) : null
  if (!claims) redirect('/auth/login')

  const user = await findUserById(claims.user_id).catch(() => null)
  if (!user || user.role !== 'admin') redirect('/')

  return children
}
