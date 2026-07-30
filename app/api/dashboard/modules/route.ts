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
import { hasLmsCredentialsAsync } from '@/lib/lms-learnworlds'
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
      }
    } else if (orgType === 'banco' || orgType === 'analytics') {
      // coach_app / banco pipelines cover the classic module set.
      for (const m of ['lms', 'coach', 'simulator', 'certification']) modules.add(m)
    }

    // The LMS is gated INDEPENDENTLY of orgType, like Second Brain below and for
    // the same reason: LearnWorlds is a separate system from every bridge above,
    // so which bridge a tenant uses says nothing about whether it has an LMS.
    //
    // This was previously nested inside the pharma branch, which made the tab
    // structurally unreachable for every other org type — rolplayAppAvailableModules()
    // derives modules from r_simulator.category and physically cannot return 'lms',
    // so a rolplay-app tenant could never show it no matter how its credentials
    // were configured. Do not move this back inside a branch.
    //
    // CREDENTIALS ARE THE ONLY GATE, and for a named tenant they must be
    // tenant-scoped (LMS_<TENANT>_*). requireScoped is what keeps this safe in a
    // multi-tenant dashboard: a bare LMS_* would otherwise show one school's
    // data to every tenant.
    //
    // TenantConfig.hasLms is deliberately NOT consulted. It cannot work as a
    // gate: a tenant defined solely by a pharma_tenants row (every tenant the
    // builder onboards) has no static config to hold the flag, and the table has
    // no has_lms column — so the flag reads false for precisely the tenants that
    // most need it. Requiring it is what kept Apotex's tab hidden after its
    // credentials were correct. Credentials cannot go missing where the LMS is
    // real, which makes them the honest signal.
    // DB-aware: reads tenant_credentials first, then env. This is what lets a
    // wizard-onboarded tenant show its LMS tab without a redeploy, and it drops
    // the dependency on an env var NAME matching the DB-assigned tenant key —
    // the mismatch that kept Apotex's tab hidden. Same resolver as the data
    // path, so the tab can never appear without resolvable credentials behind it.
    const lmsTenant = orgType === 'pharma' ? await resolvePharmaTenant(ctx.email) : null
    if (await hasLmsCredentialsAsync(lmsTenant)) modules.add('lms')

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
