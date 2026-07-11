/**
 * db-tenants.ts — CRUD for self-service pharma tenant config (Auth PostgreSQL DB).
 *
 * Lets a manager register/update a pharma-sim client without a developer
 * editing lib/pharma-tenant.ts. Rows here are merged over the hardcoded
 * defaults at runtime by ensureDynamicTenantsLoaded() in pharma-tenant.ts.
 */

import { authQuery, AuthDbError } from './db-auth'

export interface PharmaTenantRow {
  tenantKey: string
  displayName: string
  kind: 'sale_exercises' | 'kpi' | 'exceltis_rest'
  url: string
  xTenant: string | null
  ucids: number[]
  hasCertification: boolean
  hasObjections: boolean
  hasBusinessLines: boolean
  hasOrganization: boolean
  hasTopStats: boolean
  coachActivityIds: number[] | null
  authHeaderName: string | null
  authHeaderValue: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface TenantSqlRow {
  tenant_key: string
  display_name: string
  kind: 'sale_exercises' | 'kpi' | 'exceltis_rest'
  url: string
  x_tenant: string | null
  ucids: number[]
  has_certification: boolean
  has_objections: boolean
  has_business_lines: boolean
  has_organization: boolean
  has_top_stats: boolean
  coach_activity_ids: number[] | null
  auth_header_name: string | null
  auth_header_value: string | null
  is_active: boolean
  created_at: Date | string
  updated_at: Date | string
}

function rowToTenant(r: TenantSqlRow): PharmaTenantRow {
  return {
    tenantKey: r.tenant_key,
    displayName: r.display_name,
    kind: r.kind,
    url: r.url,
    xTenant: r.x_tenant,
    ucids: r.ucids ?? [],
    hasCertification: r.has_certification,
    hasObjections: r.has_objections,
    hasBusinessLines: r.has_business_lines,
    hasOrganization: r.has_organization,
    hasTopStats: r.has_top_stats,
    coachActivityIds: r.coach_activity_ids,
    authHeaderName: r.auth_header_name,
    authHeaderValue: r.auth_header_value,
    isActive: r.is_active,
    createdAt: typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : r.updated_at.toISOString(),
  }
}

const SELECT_COLS = `tenant_key, display_name, kind, url, x_tenant, ucids,
  has_certification, has_objections, has_business_lines, has_organization, has_top_stats,
  coach_activity_ids, auth_header_name, auth_header_value, is_active, created_at, updated_at`

/** All active tenant rows — used to populate the runtime config cache. */
export async function listActiveTenants(): Promise<PharmaTenantRow[]> {
  try {
    const rows = await authQuery<TenantSqlRow>(
      `SELECT ${SELECT_COLS} FROM pharma_tenants WHERE is_active = TRUE ORDER BY tenant_key`
    )
    return rows.map(rowToTenant)
  } catch (err) {
    if (err instanceof AuthDbError && err.code === 'TABLE_MISSING') return []
    throw err
  }
}

/** All tenants including inactive ones — for the admin list view. */
export async function listAllTenants(): Promise<PharmaTenantRow[]> {
  try {
    const rows = await authQuery<TenantSqlRow>(
      `SELECT ${SELECT_COLS} FROM pharma_tenants ORDER BY tenant_key`
    )
    return rows.map(rowToTenant)
  } catch (err) {
    if (err instanceof AuthDbError && err.code === 'TABLE_MISSING') return []
    throw err
  }
}

export async function getTenantRow(tenantKey: string): Promise<PharmaTenantRow | null> {
  const rows = await authQuery<TenantSqlRow>(
    `SELECT ${SELECT_COLS} FROM pharma_tenants WHERE tenant_key = $1 LIMIT 1`,
    [tenantKey.toLowerCase().trim()]
  )
  return rows.length > 0 ? rowToTenant(rows[0]) : null
}

export interface UpsertTenantInput {
  tenantKey: string
  displayName: string
  kind: 'sale_exercises' | 'kpi' | 'exceltis_rest'
  url: string
  xTenant?: string | null
  ucids: number[]
  hasCertification?: boolean
  hasObjections?: boolean
  hasBusinessLines?: boolean
  hasOrganization?: boolean
  hasTopStats?: boolean
  coachActivityIds?: number[] | null
  authHeaderName?: string | null
  authHeaderValue?: string | null
  createdBy?: number | null
}

export async function upsertTenant(input: UpsertTenantInput): Promise<PharmaTenantRow> {
  const rows = await authQuery<TenantSqlRow>(
    `INSERT INTO pharma_tenants
       (tenant_key, display_name, kind, url, x_tenant, ucids,
        has_certification, has_objections, has_business_lines, has_organization, has_top_stats,
        coach_activity_ids, auth_header_name, auth_header_value, created_by, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, NOW(), NOW())
     ON CONFLICT (tenant_key) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       kind = EXCLUDED.kind,
       url = EXCLUDED.url,
       x_tenant = EXCLUDED.x_tenant,
       ucids = EXCLUDED.ucids,
       has_certification = EXCLUDED.has_certification,
       has_objections = EXCLUDED.has_objections,
       has_business_lines = EXCLUDED.has_business_lines,
       has_organization = EXCLUDED.has_organization,
       has_top_stats = EXCLUDED.has_top_stats,
       coach_activity_ids = EXCLUDED.coach_activity_ids,
       auth_header_name = EXCLUDED.auth_header_name,
       auth_header_value = EXCLUDED.auth_header_value,
       is_active = TRUE,
       updated_at = NOW()
     RETURNING ${SELECT_COLS}`,
    [
      input.tenantKey.toLowerCase().trim(),
      input.displayName,
      input.kind,
      input.url,
      input.xTenant ?? null,
      JSON.stringify(input.ucids ?? []),
      input.hasCertification ?? false,
      input.hasObjections ?? false,
      input.hasBusinessLines ?? false,
      input.hasOrganization ?? false,
      input.hasTopStats ?? false,
      input.coachActivityIds ? JSON.stringify(input.coachActivityIds) : null,
      input.authHeaderName ?? null,
      input.authHeaderValue ?? null,
      input.createdBy ?? null,
    ]
  )
  return rowToTenant(rows[0])
}

export async function setTenantActive(tenantKey: string, isActive: boolean): Promise<void> {
  await authQuery(
    `UPDATE pharma_tenants SET is_active = $1, updated_at = NOW() WHERE tenant_key = $2`,
    [isActive, tenantKey.toLowerCase().trim()]
  )
}

export async function deleteTenant(tenantKey: string): Promise<void> {
  await authQuery(`DELETE FROM pharma_tenants WHERE tenant_key = $1`, [tenantKey.toLowerCase().trim()])
}

// ── Domain mappings ────────────────────────────────────────────────────────────

export async function listDomainMappings(): Promise<{ domain: string; tenantKey: string }[]> {
  try {
    const rows = await authQuery<{ domain: string; tenant_key: string }>(
      `SELECT domain, tenant_key FROM pharma_tenant_domains ORDER BY domain`
    )
    return rows.map(r => ({ domain: r.domain, tenantKey: r.tenant_key }))
  } catch (err) {
    if (err instanceof AuthDbError && err.code === 'TABLE_MISSING') return []
    throw err
  }
}

/**
 * Domains for ACTIVE tenants only — used by the runtime resolver so
 * deactivating a tenant immediately stops its domain(s) from resolving,
 * rather than waiting for someone to also delete the domain rows.
 */
export async function listActiveDomainMappings(): Promise<{ domain: string; tenantKey: string }[]> {
  try {
    const rows = await authQuery<{ domain: string; tenant_key: string }>(
      `SELECT d.domain, d.tenant_key
         FROM pharma_tenant_domains d
         JOIN pharma_tenants pt ON pt.tenant_key = d.tenant_key
        WHERE pt.is_active = TRUE
        ORDER BY d.domain`
    )
    return rows.map(r => ({ domain: r.domain, tenantKey: r.tenant_key }))
  } catch (err) {
    if (err instanceof AuthDbError && err.code === 'TABLE_MISSING') return []
    throw err
  }
}

export async function addDomainMapping(domain: string, tenantKey: string): Promise<void> {
  await authQuery(
    `INSERT INTO pharma_tenant_domains (domain, tenant_key, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (domain) DO UPDATE SET tenant_key = EXCLUDED.tenant_key`,
    [domain.toLowerCase().trim(), tenantKey.toLowerCase().trim()]
  )
}

export async function removeDomainMapping(domain: string): Promise<void> {
  await authQuery(`DELETE FROM pharma_tenant_domains WHERE domain = $1`, [domain.toLowerCase().trim()])
}
