/**
 * pharma-tenant.ts
 *
 * Resolves an authenticated user's email to a pharma-sim bridge tenant.
 * These orgs live on serv.aux-rolplay.com behind the rolplay-shared-bridge
 * (see bridge-pharma-analytics.ts) — a completely separate infrastructure
 * from the standard coach_app/rolplay_pro_analytics pipeline and from Banco.
 *
 * Add a tenant here + set its env vars to onboard a new pharma-sim client —
 * no other code changes required (bridge-pharma-analytics.ts branches on the
 * tenant slug returned here).
 *
 * PHARMA_TENANT_DOMAINS = "sanfer:sanfer.com.mx,apotex:apotex.com"
 */

export type PharmaTenant = 'sanfer' | 'apotex'

const KNOWN_TENANTS: PharmaTenant[] = ['sanfer', 'apotex']

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
