/**
 * GET  /api/admin/tenants — list every pharma tenant (hardcoded defaults + DB rows).
 * POST /api/admin/tenants — register a new tenant (or update an existing one, same key).
 *
 * Admin-only (role === 'admin' on the authenticated user). This is the API
 * behind the self-service onboarding wizard (app/admin/tenants) — a manager
 * fills the form, this route writes a pharma_tenants row, and the new
 * tenant's dashboard works on the next login with zero code changes.
 */

import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { listAllTenants, upsertTenant, addDomainMapping, listDomainMappings } from '@/lib/db-tenants'
import { invalidateDynamicTenantsCache, TENANT_CONFIG } from '@/lib/pharma-tenant'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  const [dbTenants, domains] = await Promise.all([listAllTenants(), listDomainMappings()])
  const dbKeys = new Set(dbTenants.map(t => t.tenantKey))

  // Hardcoded (developer-onboarded) tenants aren't editable through this
  // route today (no DB row to update) — surfaced read-only so the admin can
  // see the full picture in one list.
  const hardcoded = Object.entries(TENANT_CONFIG)
    .filter(([key]) => !dbKeys.has(key))
    .map(([key, cfg]) => ({
      tenantKey: key,
      displayName: key,
      source: 'code' as const,
      ...cfg,
    }))

  const dynamic = dbTenants.map(t => ({ ...t, source: 'admin' as const }))

  return buildSuccess({
    tenants: [...dynamic, ...hardcoded],
    domains,
  })
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  let body: {
    tenantKey?: string
    displayName?: string
    kind?: string
    url?: string
    xTenant?: string
    ucids?: number[]
    hasCertification?: boolean
    hasObjections?: boolean
    hasBusinessLines?: boolean
    hasOrganization?: boolean
    hasTopStats?: boolean
    coachActivityIds?: number[]
    authHeaderName?: string
    authHeaderValue?: string
    domains?: string[]
  }
  try {
    body = await request.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const tenantKey = body.tenantKey?.trim().toLowerCase()
  if (!tenantKey || !/^[a-z0-9_-]+$/.test(tenantKey)) {
    return buildApiError('tenantKey is required (lowercase letters/numbers/-/_ only)', 400)
  }
  if (!body.displayName?.trim()) return buildApiError('displayName is required', 400)
  if (!body.url?.trim()) return buildApiError('url is required', 400)
  if (!['sale_exercises', 'kpi', 'exceltis_rest'].includes(body.kind ?? '')) {
    return buildApiError("kind must be one of: sale_exercises, kpi, exceltis_rest", 400)
  }
  if (!Array.isArray(body.ucids) || body.ucids.length === 0) {
    return buildApiError('At least one exercise/usecase ID is required', 400)
  }
  if (body.ucids.some(id => !Number.isInteger(id))) {
    return buildApiError('ucids must all be integers', 400)
  }

  try {
    const tenant = await upsertTenant({
      tenantKey,
      displayName: body.displayName.trim(),
      kind: body.kind as 'sale_exercises' | 'kpi' | 'exceltis_rest',
      url: body.url.trim(),
      xTenant: body.xTenant?.trim() || null,
      ucids: body.ucids,
      hasCertification: body.hasCertification ?? false,
      hasObjections: body.hasObjections ?? false,
      hasBusinessLines: body.hasBusinessLines ?? false,
      hasOrganization: body.hasOrganization ?? false,
      hasTopStats: body.hasTopStats ?? false,
      coachActivityIds: body.coachActivityIds && body.coachActivityIds.length > 0 ? body.coachActivityIds : null,
      authHeaderName: body.authHeaderName?.trim() || null,
      authHeaderValue: body.authHeaderValue?.trim() || null,
      createdBy: admin.userId,
    })

    const domains = (body.domains ?? []).map(d => d.trim().toLowerCase()).filter(Boolean)
    for (const domain of domains) {
      await addDomainMapping(domain, tenantKey)
    }

    invalidateDynamicTenantsCache()

    return buildSuccess({ tenant, domains })
  } catch (err) {
    return buildApiError(`Failed to save tenant: ${(err as Error).message}`, 500)
  }
}
