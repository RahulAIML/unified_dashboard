/**
 * POST /api/admin/tenants/probe — heuristic auto-detect for the onboarding wizard.
 *
 * Admin-only. Given a bare endpoint URL, suggests which of the 3 known
 * backend kinds it speaks. Always a suggestion, never auto-applied — see
 * lib/tenant-probe.ts for why.
 */

import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { probeTenantEndpoint } from '@/lib/tenant-probe'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  let body: { url?: string; xTenant?: string }
  try {
    body = await request.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  if (!body.url?.trim()) return buildApiError('url is required', 400)

  const result = await probeTenantEndpoint(body.url.trim(), body.xTenant?.trim())
  return buildSuccess(result)
}
