/**
 * pharma-tenant.ts
 *
 * Resolves an authenticated user's email to a pharma-sim bridge tenant.
 * These orgs live on serv.aux-rolplay.com — a completely separate
 * infrastructure from the standard coach_app/rolplay_pro_analytics
 * pipeline and from Banco.
 *
 * Two bridge kinds:
 *   'sale_exercises' — direct query pattern (sale_exercises + usecases
 *      tables, saex_rp_client discriminator). Sanfer (DB1), Weser, and
 *      Adium all use this shape — either via rolplay-shared-bridge (PHP,
 *      X-Tenant header) or a standalone Node bridge (own URL, no header).
 *   'kpi' — purpose-built kpi.* aggregate actions. Apotex only, so far.
 *
 * Add a tenant here + set its env vars to onboard a new pharma-sim client —
 * see bridge-pharma-analytics.ts for the adapter functions that branch on
 * `kind`.
 *
 * PHARMA_TENANT_DOMAINS = "sanfer:sanfer.com.mx,apotex:apotex.com,weser:weserpharma.com,adium:adium.com.co"
 */

export type PharmaTenant = 'sanfer' | 'apotex' | 'weser' | 'adium'

interface TenantConfig {
  kind: 'sale_exercises' | 'kpi'
  /** Full bridge URL. For unified-bridge tenants, built from PHARMA_BRIDGE_BASE_URL + tenant + X-Tenant header. */
  url: string
  /** X-Tenant header value — omitted for standalone bridges that are already single-tenant. */
  xTenant?: string
  /** saex_rp_client filter value (sale_exercises kind only). */
  client?: string
  /** Fixed usecase ID allowlist (sale_exercises kind only) — omit for "all usecases" (Sanfer). */
  ucids?: number[]
}

function unifiedBridgeUrl(tenant: string): string {
  const base = process.env.PHARMA_BRIDGE_BASE_URL
  if (!base) throw new Error('PHARMA_BRIDGE_BASE_URL is not configured')
  return `${base.replace(/\/+$/, '')}/${tenant}/bridge/`
}

export const TENANT_CONFIG: Record<PharmaTenant, TenantConfig> = {
  sanfer: { kind: 'sale_exercises', url: unifiedBridgeUrl('sanfer'), xTenant: 'sanfer', client: 'sanfer' },
  apotex: { kind: 'kpi',            url: unifiedBridgeUrl('apotex'), xTenant: 'apotex' },
  weser:  { kind: 'sale_exercises', url: 'https://serv.aux-rolplay.com/weser/bridge/', client: 'WeserPharma', ucids: [235, 236, 237] },
  adium:  { kind: 'sale_exercises', url: 'https://serv.aux-rolplay.com/adium/bridge/', client: 'adium-co',    ucids: [145, 146, 208, 231] },
}

const KNOWN_TENANTS = Object.keys(TENANT_CONFIG) as PharmaTenant[]

function domainMap(): Map<string, PharmaTenant> {
  const raw = process.env.PHARMA_TENANT_DOMAINS ?? ''
  const map = new Map<string, PharmaTenant>()
  for (const entry of raw.split(',')) {
    const [tenant, domain] = entry.split(':').map(s => s.trim().toLowerCase())
    if (!tenant || !domain) continue
    if (!KNOWN_TENANTS.includes(tenant as PharmaTenant)) continue
    map.set(domain, tenant as PharmaTenant)
  }
  return map
}

export function resolvePharmaTenant(email: string): PharmaTenant | null {
  const userDomain = email.toLowerCase().split('@')[1] ?? ''
  if (!userDomain) return null
  return domainMap().get(userDomain) ?? null
}
