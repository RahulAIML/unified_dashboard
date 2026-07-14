/**
 * org-type.ts
 *
 * Server-side utility for resolving which analytics pipeline an authenticated
 * user belongs to. Import this in API routes — never in client components.
 *
 * Four data sources:
 *   'banco'      → banco-domain orgs → Second Brain (see banco-second-brain.ts)
 *   'pharma'     → per-tenant PHP bridge (serv.aux-rolplay.com) — see pharma-tenant.ts
 *   'rolplay-app' → standalone Rolplay app platform (r_* tables via raw-SQL) —
 *                   counts-only, resolved by explicit login map (bridge-rolplay-app.ts)
 *   'analytics' → rolplay_pro_analytics via PHP bridge (customer_id scoped)
 *   'none'      → authenticated but no recognized data source
 *
 * Second Brain is probed separately (API call) and does not affect org type.
 */
import { resolvePharmaTenant } from './pharma-tenant'
import { resolveRolplayAppClientId } from './bridge-rolplay-app'

/**
 * Returns true when the given email belongs to the Banco organization.
 * Identification is domain-based because banco_users has no email column.
 * Set BANCO_EMAIL_DOMAINS=bancoppel.com,coppel.com (comma-separated) in env.
 */
export function isBancoOrg(email: string): boolean {
  const raw = process.env.BANCO_EMAIL_DOMAINS ?? ""
  if (!raw.trim()) return false
  const domains = raw.split(",").map(d => d.trim().toLowerCase()).filter(Boolean)
  const userDomain = email.toLowerCase().split("@")[1] ?? ""
  return domains.includes(userDomain)
}

/**
 * Resolves which analytics pipeline serves this user.
 *
 * @param email      - Authenticated user email (from JWT)
 * @param customerId - Resolved customer_id from login (0 = not in coach_users)
 */
export async function resolveOrgType(
  email: string,
  customerId: number,
): Promise<'banco' | 'pharma' | 'rolplay-app' | 'analytics' | 'none'> {
  if (isBancoOrg(email))                 return 'banco'
  if (await resolvePharmaTenant(email))  return 'pharma'
  // Before analytics: rolplay-app clients can share a domain with a coach_app
  // analytics customer (audioweb.com.mx), so the explicit login map wins.
  if (resolveRolplayAppClientId(email))  return 'rolplay-app'
  if (customerId > 0)                    return 'analytics'
  return 'none'
}
