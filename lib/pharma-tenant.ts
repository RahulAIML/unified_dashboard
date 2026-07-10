/**
 * pharma-tenant.ts
 *
 * Resolves an authenticated user's email to a pharma-sim bridge tenant, and
 * describes each tenant's REAL module boundaries — verified against the
 * actual Sanfer_dashboard React source (D:/Sanfer_dashboard), the Apotex
 * bridge's own activity groupings, and (for the exceltis_rest tenants below)
 * each client's real app.py + a direct query of sale_exercises grouped by
 * saex_rp_client — not assumed.
 *
 * Every pharma tenant's dashboard has DIFFERENT underlying data per module —
 * Simulador, Coach Maestro, and Certificación are NOT the same numbers
 * reshuffled. Config below encodes exactly which bridge action(s) back each
 * module so bridge-pharma-analytics.ts never has to guess.
 *
 * Three bridge kinds:
 *   'sale_exercises' — Sanfer, Weser, Adium. Raw per-session rows via an
 *      action-dispatch bridge (POST {action, ...}). `ucids` MUST match the
 *      real dashboard's own certification exercise list (Sanfer's is the
 *      exact 44-ID list from src/api/client.ts — a broader "all activity"
 *      scan silently returns a DIFFERENT, larger total than the real
 *      dashboard). `certification` (Sanfer only) points at a WHOLLY
 *      SEPARATE data source — the official platform DB's
 *      profiles_assigned/fase tracking — not a filtered view of session data.
 *   'kpi' — Apotex. `coachActivityIds` (verified: 8, 9, 10 = Periamid,
 *      Parkinson, Neristren) is the actual "Coach Maestro" module; every
 *      other activity_id is "Simulador" — different rows of the SAME kpi.*
 *      query, filtered, not two identical pulls.
 *   'exceltis_rest' — Heineken, M8, Lacoste, Lacoste Asistentes, Chiesi,
 *      Labomed. Existing, already-deployed Flask REST endpoints (GET
 *      /api/rol_play_sim_extractor + /api/dim_actividades, NOT an action
 *      bridge) — verified by pulling each client's real app.py. `ucids` are
 *      each app.py's own hardcoded valid-ID allowlist (Chiesi/Labomed have
 *      none enforced server-side, so their list here is the actual
 *      distinct saex_useCases found under their saex_rp_client in the DB —
 *      the only reliable source of truth when the endpoint itself doesn't
 *      restrict it).
 *
 * Modules with no verified real data source (LMS, Second Brain, and
 * Coach/Certification for any tenant without a confirmed split) return
 * empty rather than reusing another module's data — none of the
 * exceltis_rest clients' app.py show any module split, unlike Sanfer/Apotex.
 *
 * PHARMA_TENANT_DOMAINS = "sanfer:sanfer.com.mx,apotex:apotex.com,adium:adium.com.co,heineken:heineken.com,m8:acino.swiss,m8:arceralifesciences.com,lacoste:lacoste-rolplay.net,chiesi:chiesi.com,labomed:itf-labomed.cl"
 * (repeat "tenant:domain" per extra domain — m8 has two real ones seen in
 * the data, Acino and Arcera Life Sciences)
 *
 * NOT onboarded yet — see conversation notes:
 *   - lacosteAsistentes IS configured above but has no PHARMA_TENANT_DOMAINS
 *     entry — its real user email domain hasn't been confirmed (may be the
 *     same as "lacoste" or may not), so it's unreachable via login until
 *     that's verified rather than guessed.
 *   - Gentera, Salinas (Grupo Elektra): sale_exercises AND their members
 *     tables have no resolvable email domain for real users (group codes /
 *     employee IDs instead of emails, confirmed by direct DB query) —
 *     email-domain tenant resolution doesn't work for these as-is; would
 *     need a different login mechanism (employee ID?) to onboard.
 *   - BancoPPEL, Lily: separate standalone Flask containers, not yet wired.
 *   - Several OTHER saex_rp_client values exist on this shared infrastructure
 *     (synthon, banorte, promass, asofarma-mexico, merck-colombia, schwabe,
 *     universidad-bancoppel, grupo-elektra-lidera) that were never in scope —
 *     flagged, not investigated further.
 */

export type PharmaTenant =
  | 'sanfer' | 'apotex' | 'weser' | 'adium'
  | 'heineken' | 'm8' | 'lacoste' | 'lacosteAsistentes' | 'chiesi' | 'labomed'

interface TenantConfig {
  kind: 'sale_exercises' | 'kpi' | 'exceltis_rest'
  url: string
  xTenant?: string
  /** Fixed usecase ID allowlist. REQUIRED for sale_exercises/exceltis_rest — matches the real dashboard's own scope. */
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
  // Verified via exceltis_dashboard_heineken/app.py — HEINEKEN_IDS (commented
  // out validation, but this is the list the real frontend uses).
  heineken: {
    kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/heineken',
    ucids: [137, 159, 173],
  },
  // Verified via exceltis_dashboard_m8/app.py — M8_IDS.
  m8: {
    kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/m8',
    ucids: [12, 113, 142],
  },
  // Verified via exceltis_dashboard_lacoste/app.py — LACOSTE_IDS.
  lacoste: {
    kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/lacoste',
    ucids: [375, 379],
  },
  // Separate container/product from "lacoste" above (own health-check name
  // "Lacoste Asistentes Dashboard API", different extractor) but shares
  // Lacoste's DB — verified via exceltis_dashboard_lacoste_asistentes/app.py.
  lacosteAsistentes: {
    kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/lacoste_asistentes',
    ucids: [167],
  },
  // No ID allowlist enforced in Chiesi's own app.py — ucids here are the
  // actual distinct saex_useCases found under saex_rp_client='chiesi' via
  // direct DB query (the only reliable source of truth available).
  chiesi: {
    kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/chiesi',
    ucids: [75, 76, 139, 140],
  },
  // Same situation as Chiesi — no server-side allowlist, ucids verified via
  // saex_rp_client='labomed' direct query.
  labomed: {
    kind: 'exceltis_rest', url: 'https://serv.aux-rolplay.com/labomed',
    ucids: [458, 463],
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
