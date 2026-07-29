/**
 * /api/dashboard/modules
 *
 * Which dashboard modules (solutions) this tenant actually has — the single
 * source of truth for dynamic rendering. The UI shows only these, so a client
 * who contracted e.g. Second Brain + Simulator never sees empty Coach/LMS tabs.
 *
 * Capability-driven, never hardcoded per client:
 *   - rolplay-app (query endpoint): derived from r_simulator.category on the
 *     client's real sessions (COACH → Master Coach, SIM → Simulator,
 *     SEGMENT → Certifier Coach).
 *   - pharma bridge: from the tenant's verified capability flags.
 *   - Second Brain: ALWAYS from the dedicated Second Brain API (its own
 *     endpoint + token), never from the query-endpoint schema.
 *   - coach_app analytics: full module set (its own pipeline covers them).
 */

import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenant, TENANT_CONFIG } from '@/lib/pharma-tenant'
import { resolveRolplayAppAccess, rolplayAppAvailableModules } from '@/lib/bridge-rolplay-app'
import { resolveSecondBrainProfile } from '@/lib/banco-second-brain'
import { hasLmsCredentials } from '@/lib/lms-learnworlds'
import { useDemoData } from '@/lib/demo'

export const runtime = 'nodejs'

const ALL: string[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  // Demo mode showcases the whole ecosystem.
  if (useDemoData(ctx.email)) return buildSuccess({ modules: ALL }, { source: 'demo' })

  try {
    const orgType = await resolveOrgType(ctx.email, ctx.customerId)
    const modules = new Set<string>()

    if (orgType === 'rolplay-app') {
      const clientId = await resolveRolplayAppAccess(ctx.email)
      if (clientId) {
        for (const m of await rolplayAppAvailableModules(clientId)) modules.add(m)
      }
    } else if (orgType === 'pharma') {
      // resolvePharmaTenant() already loads dynamic tenants into TENANT_CONFIG.
      const tenant = await resolvePharmaTenant(ctx.email)
      const cfg = tenant ? TENANT_CONFIG[tenant] : null
      if (cfg) {
        // Simulator defaults on — every pharma bridge exposes sim data — but an
        // LMS-only client can opt out rather than get a tab with nothing in it.
        if (cfg.hasSimulator !== false) modules.add('simulator')
        if (cfg.hasCertification) modules.add('certification')
        if (cfg.coachActivityIds?.length) modules.add('coach')
        // The LMS is a separate system from the bridge, so it needs both the
        // tenant's intent and real credentials — otherwise the tab would open
        // onto an empty state that looks like an outage.
        if (cfg.hasLms && hasLmsCredentials(tenant)) modules.add('lms')
      }
    } else if (orgType === 'banco' || orgType === 'analytics') {
      // coach_app / banco pipelines cover the classic module set.
      for (const m of ['lms', 'coach', 'simulator', 'certification']) modules.add(m)
    }

    // Second Brain is independent of the above: it resolves only if the tenant
    // has its OWN Second Brain org on the dedicated API.
    const sb = await resolveSecondBrainProfile(ctx.email, ctx.customerId).catch(() => null)
    if (sb) modules.add('second-brain')

    // Preserve canonical order for stable UI.
    const ordered = ALL.filter(m => modules.has(m))
    return buildSuccess({ modules: ordered }, { orgType, source: `modules-${orgType}` })
  } catch (err) {
    console.error('[/api/dashboard/modules]', err)
    // Fail open with the full set rather than hiding a client's real modules.
    return buildSuccess({ modules: ALL }, { source: 'fallback' })
  }
}
