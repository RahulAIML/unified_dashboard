/**
 * /api/dashboard/data-bounds
 *
 * Returns the authenticated tenant's real data span { from, to } (ISO) so the
 * client can snap its default date range to actual data instead of an arbitrary
 * trailing window (see lib/hooks/useSnapDateRange). Pipeline-aware, mirroring
 * the org resolution used by /api/dashboard/overview.
 *
 * Response: { success: true, data: { from: string, to: string } | null }
 *   data === null  → no data / unknown pipeline / demo → client keeps its
 *                    default window rather than snapping.
 */

import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { pharmaDataBounds } from '@/lib/bridge-pharma-analytics'
import { bridgeAnalyticsDataBounds } from '@/lib/bridge-client'
import { bridgeBancoDataBounds } from '@/lib/bridge-banco'
import { resolveRolplayAppAccess, rolplayAppDataBounds } from '@/lib/bridge-rolplay-app'
import { isDemoMode } from '@/lib/demo'

export const runtime = 'nodejs'

/** MySQL DATETIME ('YYYY-MM-DD HH:MM:SS') or plain date → ISO; null-safe. */
function toIso(value: string): string | null {
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // Demo mode has its own fixed dataset — let the client keep its default range.
  if (isDemoMode()) return buildSuccess(null, { source: 'demo' })

  try {
    const orgType = await resolveOrgType(ctx.email, ctx.customerId)

    let bounds: { min: string; max: string } | null = null
    let source: string = orgType

    if (orgType === 'banco') {
      bounds = await bridgeBancoDataBounds()
    } else if (orgType === 'pharma') {
      const tenant = await resolvePharmaTenant(ctx.email)
      if (tenant) {
        bounds = await pharmaDataBounds(tenant)
        source = `pharma-${tenant}`
      }
    } else if (orgType === 'rolplay-app') {
      const clientId = await resolveRolplayAppAccess(ctx.email)
      if (clientId) {
        bounds = await rolplayAppDataBounds(clientId)
        source = `rolplay-app-${clientId}`
      }
    } else if (orgType === 'analytics') {
      bounds = await bridgeAnalyticsDataBounds(ctx.customerId)
    }

    if (!bounds) return buildSuccess(null, { source })

    const from = toIso(bounds.min)
    const to = toIso(bounds.max)
    if (!from || !to) return buildSuccess(null, { source })

    return buildSuccess({ from, to }, { source })
  } catch (err) {
    console.error('[/api/dashboard/data-bounds]', err)
    // Non-fatal: a bounds failure must never block the dashboard — the client
    // simply falls back to its default window.
    return buildSuccess(null)
  }
}
