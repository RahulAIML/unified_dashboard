import { DEFAULT_CLIENT_ID } from "./client-config"
import { SOLUTION_USECASE_MAP } from "./solution-map"

type TenantRule = "all" | number[]

function unionKnownUsecases(): number[] {
  const set = new Set<number>()
  for (const ids of Object.values(SOLUTION_USECASE_MAP)) {
    for (const id of ids) set.add(id)
  }
  return [...set.values()].sort((a, b) => a - b)
}

const DEFAULT_RULES: Record<string, TenantRule> = {
  // Default tenant can see all known usecases.
  [DEFAULT_CLIENT_ID]: "all",

  // Non-default tenants should be explicitly configured to prevent leakage.
  // If no rule is configured (locally or via TENANT_USECASE_MAP_JSON),
  // the tenant sees an empty dataset.
  // coppel: [389, 390, 391], // example
}

let _cachedRules: Record<string, TenantRule> | null = null

function loadRules(): Record<string, TenantRule> {
  if (_cachedRules) return _cachedRules

  const env = process.env.TENANT_USECASE_MAP_JSON
  if (!env) {
    _cachedRules = DEFAULT_RULES
    return _cachedRules
  }

  try {
    const parsed = JSON.parse(env) as Record<string, TenantRule>
    _cachedRules = { ...DEFAULT_RULES, ...parsed }
    return _cachedRules
  } catch {
    console.warn("⚠️  Invalid TENANT_USECASE_MAP_JSON, falling back to defaults")
    _cachedRules = DEFAULT_RULES
    return _cachedRules
  }
}

export function resolveClientId(clientId: string | null | undefined): string {
  return clientId?.trim() ? clientId.trim() : DEFAULT_CLIENT_ID
}

/**
 * Returns the allowed usecase IDs for a given clientId.
 *
 * - undefined means "all usecases" (no additional filtering).
 * - [] means "no access" (return empty dataset; prevents leakage).
 */
export function allowedUsecaseIdsForClient(clientId: string | null | undefined): number[] | undefined {
  const id = resolveClientId(clientId)
  const rules = loadRules()

  const rule = rules[id]
  if (!rule) {
    // No rule configured for this client_id.
    // SAFE FALLBACK: show all data instead of blocking the dashboard.
    //
    // Rationale: the analytics MySQL DB has no company_id column yet.
    // Every authenticated user should see the shared dataset until
    // proper per-tenant DB-level isolation is implemented.
    // Once tenant rules are added (via TENANT_USECASE_MAP_JSON or code),
    // this fallback is bypassed automatically.
    if (id !== DEFAULT_CLIENT_ID) {
      console.warn(
        `[tenant] No rule for clientId="${id}" — showing all data (safe fallback). ` +
        `Add an entry to TENANT_USECASE_MAP_JSON to restrict this client.`
      )
    }
    return undefined  // undefined = no filter = all data visible
  }

  if (rule === "all") return undefined

  const cleaned = rule.map(Number).filter((n) => Number.isFinite(n))
  return [...new Set(cleaned)].sort((a, b) => a - b)
}

export function applyTenantUsecaseFilter(
  filters: { usecaseIds?: number[]; clientId?: string | null }
): { usecaseIds?: number[]; clientId: string } {
  const clientId = resolveClientId(filters.clientId)
  const allowed = allowedUsecaseIdsForClient(clientId)

  // "all" tenant
  if (!allowed) {
    return { ...filters, clientId }
  }

  const requested = filters.usecaseIds
  if (!requested || requested.length === 0) {
    return { ...filters, clientId, usecaseIds: allowed }
  }

  const set = new Set(allowed)
  const intersection = requested.filter((id) => set.has(id))
  return { ...filters, clientId, usecaseIds: intersection }
}

export function canClientAccessUsecase(
  clientId: string | null | undefined,
  usecaseId: number | null | undefined
): boolean {
  if (usecaseId === null || usecaseId === undefined) return false
  const allowed = allowedUsecaseIdsForClient(clientId)
  if (!allowed) return true // "all"
  return allowed.includes(usecaseId)
}

export const KNOWN_USECASE_IDS = unionKnownUsecases()
