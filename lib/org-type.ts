/**
 * org-type.ts
 *
 * Server-side utility for resolving which analytics pipeline an authenticated
 * user belongs to. Import this in API routes — never in client components.
 *
 * Four data sources:
 *   'banco'     → coach_app.banco_users / saved_reports / saved_reports_options
 *   'pharma'     → per-tenant PHP bridge (serv.aux-rolplay.com) — see pharma-tenant.ts
 *   'analytics' → rolplay_pro_analytics via PHP bridge (customer_id scoped)
 *   'none'      → authenticated but no recognized data source
 *
 * Second Brain is probed separately (API call) and does not affect org type.
 */
import { resolvePharmaTenant } from './pharma-tenant'

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
export function resolveOrgType(
  email: string,
  customerId: number,
): 'banco' | 'pharma' | 'analytics' | 'none' {
  if (isBancoOrg(email))            return 'banco'
  if (resolvePharmaTenant(email))   return 'pharma'
  if (customerId > 0)               return 'analytics'
  return 'none'
}
