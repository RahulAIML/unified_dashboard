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

// PharmaTenant used to be a fixed string-literal union of the hand-onboarded
// clients below. It's now a plain string so tenants registered through the
// admin wizard (app/admin/tenants) work without a code change — see
// ensureDynamicTenantsLoaded() further down, which merges DB rows (lib/db-tenants.ts)
// over these hardcoded defaults at runtime.
export type PharmaTenant = string

export interface TenantConfig {
  kind: 'sale_exercises' | 'kpi' | 'exceltis_rest'
  url: string
  xTenant?: string
  /** Fixed usecase ID allowlist. REQUIRED for sale_exercises/exceltis_rest — matches the real dashboard's own scope. */
  ucids?: number[]
  /** True only where a genuinely separate certification data source is confirmed (Sanfer: official platform DB). */
  hasCertification?: boolean
  /** kpi kind only — activity_ids that are the real "Coach Maestro" module, verified against kpi.activity_summary. */
  coachActivityIds?: number[]
  /** True only where objections.demorp6 is confirmed present and working (Sanfer). */
  hasObjections?: boolean
  /** True only where a members-tag "business lines" catalog (tag1 table) is confirmed present (Sanfer). */
  hasBusinessLines?: boolean
  /** True only where org.members/org.admins are confirmed present and working (Sanfer). */
  hasOrganization?: boolean
  /** True only where sim.topstats (all-time leaderboard) is confirmed present (Sanfer). */
  hasTopStats?: boolean
  /** Extra header to send when this tenant's endpoint lives on a different server and needs its own auth. */
  authHeaderName?: string
  authHeaderValue?: string
}

function unifiedBridgeUrl(tenant: string): string | null {
  const base = process.env.PHARMA_BRIDGE_BASE_URL?.trim()
  if (!base) return null
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

// Mutable — ensureDynamicTenantsLoaded() below adds/overwrites entries from
// the pharma_tenants DB table on top of these hand-verified defaults. Every
// downstream read (bridge-pharma-analytics.ts, API routes) is synchronous and
// happens only after a route has already called resolvePharmaTenant()/
// resolveOrgType() for the current request, which is the single choke point
// that awaits the DB load — so TENANT_CONFIG is always fully populated by
// the time anything else reads it.
export const TENANT_CONFIG: Record<PharmaTenant, TenantConfig> = {
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

const sanferBridgeUrl = unifiedBridgeUrl('sanfer')
if (sanferBridgeUrl) {
  TENANT_CONFIG.sanfer = {
    kind: 'sale_exercises',
    url: sanferBridgeUrl,
    xTenant: 'sanfer',
    ucids: SANFER_CERT_IDS,
    hasCertification: true,
    hasObjections: true,
    hasBusinessLines: true,
    hasOrganization: true,
  }
}

const apotexBridgeUrl = unifiedBridgeUrl('apotex')
if (apotexBridgeUrl) {
  TENANT_CONFIG.apotex = {
    kind: 'kpi',
    url: apotexBridgeUrl,
    xTenant: 'apotex',
    coachActivityIds: [8, 9, 10],
    // Verified live: list.members/list.admins return real rows (61 members,
    // 21 admins) using the exact same field names as Sanfer's org.members/
    // org.admins (mb_fullname, mb_email, mb_admin, rpa_full_name, rpa_email,
    // rpa_profile_type) — same underlying bridge protocol, different action
    // name and response wrapper key ("members"/"admins" vs "data").
    hasOrganization: true,
  }
}

// Dynamic (admin-wizard-registered) domains, merged with PHARMA_TENANT_DOMAINS below.
const dynamicDomainMap = new Map<string, PharmaTenant>()

// Built-in domain aliases — real user domains that differ from the primary
// domain a tenant was configured with. Apotex's real reps are on apotex.com.mx,
// but the tenant is keyed apotex.com; without this alias a real @apotex.com.mx
// login resolves to no tenant. Lowest priority (env + DB can override).
const DEFAULT_DOMAIN_ALIASES: Record<string, PharmaTenant> = {
  'apotex.com.mx': 'apotex',
}

function envDomainMap(): Map<string, PharmaTenant> {
  const raw = process.env.PHARMA_TENANT_DOMAINS ?? ''
  const map = new Map<string, PharmaTenant>()
  for (const entry of raw.split(',')) {
    const [tenant, domain] = entry.split(':').map(s => s.trim().toLowerCase())
    if (!tenant || !domain) continue
    map.set(domain, tenant)
  }
  return map
}

function domainMap(): Map<string, PharmaTenant> {
  // Priority: dynamic (admin-configured) > env > built-in aliases.
  return new Map([
    ...Object.entries(DEFAULT_DOMAIN_ALIASES),
    ...envDomainMap(),
    ...dynamicDomainMap,
  ])
}

// ── DB-backed dynamic tenants ──────────────────────────────────────────────────
// Loaded lazily, cached in-process for DYNAMIC_TENANTS_TTL_MS so a request
// doesn't hit Postgres on every single dashboard call. Admin writes (POST/PATCH
// /api/admin/tenants) call invalidateDynamicTenantsCache() so changes are
// visible immediately rather than waiting out the TTL.
const DYNAMIC_TENANTS_TTL_MS = 30_000
let dynamicTenantsLoadedAt = 0
let dynamicTenantsPromise: Promise<void> | null = null

// Tracks which TENANT_CONFIG keys came from the DB on the last load, so a
// tenant that gets deactivated (and drops out of listActiveTenants()) can be
// removed from TENANT_CONFIG instead of leaving a stale entry behind —
// otherwise resolvePharmaTenant() would stop returning its key (fixed by the
// active-only domain query below) but any code that already had the key would
// still see last-known-good config for it.
let previouslyLoadedDynamicKeys = new Set<string>()

async function loadDynamicTenants(): Promise<void> {
  // Import lazily so this file (used by client-safe org-type checks in some
  // contexts historically) never pulls in the pg-backed db layer unless a
  // dynamic load is actually needed.
  const { listActiveTenants, listActiveDomainMappings } = await import('./db-tenants')
  const [tenants, domains] = await Promise.all([
    listActiveTenants().catch(() => []),
    listActiveDomainMappings().catch(() => []),
  ])

  const currentKeys = new Set(tenants.map(t => t.tenantKey))
  for (const staleKey of previouslyLoadedDynamicKeys) {
    if (!currentKeys.has(staleKey)) delete TENANT_CONFIG[staleKey]
  }
  previouslyLoadedDynamicKeys = currentKeys

  for (const t of tenants) {
    // A built-in tenant (sanfer/apotex/…) already has a hand-verified static
    // config in TENANT_CONFIG at this point. The pharma_tenants columns default
    // to FALSE, so a DB row that was seeded without explicitly setting the
    // capability flags would otherwise CLOBBER those verified flags and make
    // Conversational / Business Lines / Organization silently return empty
    // (overview still works because ucids are populated). Capability flags mean
    // "this tenant HAS this data", so OR the DB value with any existing static
    // value: the DB can still ENABLE a capability for a brand-new self-service
    // tenant (prev is undefined → uses DB flags as-is), but it can never DROP a
    // built-in's known capability. Same idea for ucids/coachActivityIds: fall
    // back to the static value when the DB row omits them.
    const prev = TENANT_CONFIG[t.tenantKey]
    TENANT_CONFIG[t.tenantKey] = {
      kind: t.kind,
      url: t.url,
      xTenant: t.xTenant ?? undefined,
      ucids: (t.ucids?.length ? t.ucids : prev?.ucids) ?? [],
      hasCertification: t.hasCertification || (prev?.hasCertification ?? false),
      hasObjections:    t.hasObjections    || (prev?.hasObjections    ?? false),
      hasBusinessLines: t.hasBusinessLines || (prev?.hasBusinessLines ?? false),
      hasOrganization:  t.hasOrganization  || (prev?.hasOrganization  ?? false),
      hasTopStats:      t.hasTopStats       || (prev?.hasTopStats      ?? false),
      coachActivityIds: t.coachActivityIds ?? prev?.coachActivityIds ?? undefined,
      authHeaderName: t.authHeaderName ?? undefined,
      authHeaderValue: t.authHeaderValue ?? undefined,
    }
  }

  dynamicDomainMap.clear()
  for (const d of domains) dynamicDomainMap.set(d.domain, d.tenantKey)
}

/** Call after any admin write so the next request picks up the change immediately. */
export function invalidateDynamicTenantsCache(): void {
  dynamicTenantsLoadedAt = 0
  dynamicTenantsPromise = null
}

async function ensureDynamicTenantsLoaded(): Promise<void> {
  const isStale = Date.now() - dynamicTenantsLoadedAt > DYNAMIC_TENANTS_TTL_MS
  if (!isStale) return
  if (!dynamicTenantsPromise) {
    dynamicTenantsPromise = loadDynamicTenants()
      .then(() => { dynamicTenantsLoadedAt = Date.now() })
      .catch((err) => {
        console.warn('[pharma-tenant] failed to load dynamic tenants (non-fatal):', (err as Error).message)
      })
      .finally(() => { dynamicTenantsPromise = null })
  }
  await dynamicTenantsPromise
}

export async function resolvePharmaTenant(email: string): Promise<PharmaTenant | null> {
  await ensureDynamicTenantsLoaded()
  const userDomain = email.toLowerCase().split('@')[1] ?? ''
  if (!userDomain) return null
  const key = domainMap().get(userDomain)
  if (!key) return null
  // Guard: a domain can be mapped (e.g. via PHARMA_TENANT_DOMAINS env) while its
  // TENANT_CONFIG entry is absent — e.g. a client that hasn't been onboarded via
  // the admin wizard yet. Treat that as "not a pharma tenant" (clean empty
  // dashboard) rather than returning a key with no config (which would crash
  // downstream on cfg.url).
  return TENANT_CONFIG[key] ? key : null
}
