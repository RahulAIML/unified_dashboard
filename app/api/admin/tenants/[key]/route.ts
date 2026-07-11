/**
 * PATCH  /api/admin/tenants/:key — update an existing DB-registered tenant.
 * DELETE /api/admin/tenants/:key — deactivate (soft-delete) a tenant.
 *
 * Admin-only. Only tenants that already have a pharma_tenants row (i.e. were
 * created through this wizard, source: 'admin') can be edited here —
 * hand-onboarded tenants in lib/pharma-tenant.ts stay code-only.
 */

import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError } from '@/lib/api-utils'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { getTenantRow, upsertTenant, setTenantActive } from '@/lib/db-tenants'
import { invalidateDynamicTenantsCache } from '@/lib/pharma-tenant'

export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  const { key } = await params
  const existing = await getTenantRow(key)
  if (!existing) return buildApiError(`No admin-registered tenant found for "${key}"`, 404)

  let body: Partial<{
    displayName: string
    kind: string
    url: string
    xTenant: string
    ucids: number[]
    hasCertification: boolean
    hasObjections: boolean
    hasBusinessLines: boolean
    hasOrganization: boolean
    hasTopStats: boolean
    coachActivityIds: number[]
    authHeaderName: string
    authHeaderValue: string
  }>
  try {
    body = await request.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  if (body.kind && !['sale_exercises', 'kpi', 'exceltis_rest'].includes(body.kind)) {
    return buildApiError("kind must be one of: sale_exercises, kpi, exceltis_rest", 400)
  }

  try {
    const tenant = await upsertTenant({
      tenantKey: existing.tenantKey,
      displayName: body.displayName ?? existing.displayName,
      kind: (body.kind as 'sale_exercises' | 'kpi' | 'exceltis_rest') ?? existing.kind,
      url: body.url ?? existing.url,
      xTenant: body.xTenant !== undefined ? body.xTenant : existing.xTenant,
      ucids: body.ucids ?? existing.ucids,
      hasCertification: body.hasCertification ?? existing.hasCertification,
      hasObjections: body.hasObjections ?? existing.hasObjections,
      hasBusinessLines: body.hasBusinessLines ?? existing.hasBusinessLines,
      hasOrganization: body.hasOrganization ?? existing.hasOrganization,
      hasTopStats: body.hasTopStats ?? existing.hasTopStats,
      coachActivityIds: body.coachActivityIds !== undefined ? body.coachActivityIds : existing.coachActivityIds,
      authHeaderName: body.authHeaderName !== undefined ? body.authHeaderName : existing.authHeaderName,
      authHeaderValue: body.authHeaderValue !== undefined ? body.authHeaderValue : existing.authHeaderValue,
      createdBy: admin.userId,
    })

    invalidateDynamicTenantsCache()
    return buildSuccess({ tenant })
  } catch (err) {
    return buildApiError(`Failed to update tenant: ${(err as Error).message}`, 500)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError('Admin access required', 403)

  const { key } = await params
  const existing = await getTenantRow(key)
  if (!existing) return buildApiError(`No admin-registered tenant found for "${key}"`, 404)

  await setTenantActive(key, false)
  invalidateDynamicTenantsCache()
  return buildSuccess({ deactivated: key })
}
