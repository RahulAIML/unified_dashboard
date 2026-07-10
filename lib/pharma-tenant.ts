/**
 * pharma-tenant.ts
 *
 * Resolves an authenticated user's email to a pharma-sim bridge tenant, and
 * describes each tenant's REAL module boundaries — verified against the
 * actual Sanfer_dashboard React source (D:/Sanfer_dashboard) and the Apotex
 * bridge's own activity groupings, not assumed.
 *
 * Every pharma tenant's dashboard has DIFFERENT underlying data per module —
 * Simulador, Coach Maestro, and Certificación are NOT the same numbers
 * reshuffled. Config below encodes exactly which bridge action(s) back each
 * module so bridge-pharma-analytics.ts never has to guess.
 *
 * Two bridge kinds:
 *   'sale_exercises' — Sanfer, Weser, Adium. Raw per-session rows from a
 *      sale_exercises/usecases-shaped schema. `ucids` MUST match the real
 *      dashboard's own certification exercise list (Sanfer's is the exact
 *      44-ID list from src/api/client.ts — using a broader "all activity"
 *      scan, as an earlier version of this file did, silently returns
 *      DIFFERENT totals than the real product).
 *      `certification` (Sanfer only) points at a WHOLLY SEPARATE data
 *      source — the official platform DB's profiles_assigned/fase
 *      tracking — not a filtered view of session data.
 *   'kpi' — Apotex. `coachActivityIds` (verified: 8, 9, 10 = Periamid,
 *      Parkinson, Neristren) is the actual "Coach Maestro" module; every
 *      other activity_id is "Simulador". These come from DIFFERENT rows
 *      of the SAME kpi.* aggregate query, filtered — not two identical
 *      pulls.
 *
 * Modules with no verified real data source (LMS, Second Brain) return
 * empty for every pharma tenant rather than reusing another module's data.
 *
 * PHARMA_TENANT_DOMAINS = "sanfer:sanfer.com.mx,apotex:apotex.com,adium:adium.com.co"
 */

export type PharmaTenant = 'sanfer' | 'apotex' | 'weser' | 'adium'

interface TenantConfig {
  kind: 'sale_exercises' | 'kpi'
  url: string
  xTenant?: string
  /** Fixed usecase ID allowlist — sale_exercises kind. REQUIRED; matches the real dashboard's own scope. */
  ucids?: number[]
  /** True only where a genuinely separate certification data source is confirmed (Sanfer: official platform DB). */
  hasCertification?: boolean
  /** kpi kind only — activity_ids that are the real "Coach Maestro" module, verified against kpi.activity_summary. */
  coachActivityIds?: number[]
}

function unifiedBridgeUrl(tenant: string): string {
  const base = process.env.PHARMA_BRIDGE_BASE_URL
  if (!base) throw new Error('PHARMA_BRIDGE_BASE_URL is not configured')
  return `${base.replace(/\/+$/, '')}/${tenant}/bridge/`
}

// Exact 44-ID certification exercise list — copied from Sanfer_dashboard's
// own src/api/client.ts (SANFER_IDS), the real product's scope. Do not
// widen this to "every usecase for this client" — that returns different
// (larger, uncertified-practice-inclusive) totals than the real dashboard.
const SANFER_CERT_IDS = [
  390, 399, 402, 403, 405, 406, 408, 409, 410, 411, 413, 419, 420, 421,
  423, 428, 432, 433, 436, 439, 440, 445, 446, 448, 449, 453, 454, 455,
  457, 460, 461, 462, 464, 465, 467, 468, 481, 484, 488, 489, 490, 491,
  492, 493,
]

export const TENANT_CONFIG: Record<PharmaTenant, TenantConfig> = {
  sanfer: {
    kind: 'sale_exercises', url: unifiedBridgeUrl('sanfer'), xTenant: 'sanfer',
    ucids: SANFER_CERT_IDS, hasCertification: true,
  },
  apotex: {
    kind: 'kpi', url: unifiedBridgeUrl('apotex'), xTenant: 'apotex',
    coachActivityIds: [8, 9, 10],
  },
  weser: {
    kind: 'sale_exercises', url: 'https://serv.aux-rolplay.com/weser/bridge/',
    ucids: [235, 236, 237],
  },
  adium: {
    kind: 'sale_exercises', url: 'https://serv.aux-rolplay.com/adium/bridge/',
    ucids: [145, 146, 208, 231],
  },
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
