/**
 * company-mapping.ts — Email domain to company mapping
 */

/**
 * EMAIL DOMAIN → CLIENT ID MAPPING
 *
 * To onboard a new client:
 *   1. Add their email domain here: 'newclient.com': 'newclient'
 *   2. Add their display name below: 'newclient': 'New Client'
 *   3. That's it — registration, login, and data filtering all pick it up automatically.
 *
 * Users whose domain is NOT in this map get client_id = first part of their domain
 * (e.g. john@acme.org → client_id = "acme"). They can still register and log in,
 * but their analytics data scope will be "acme".
 */
const COMPANY_DOMAIN_MAP: Record<string, string> = {
  // Coppel
  'coppel.com':    'coppel',
  'coppel.com.mx': 'coppel',
  'coppel.mx':     'coppel',

  // RolPlay internal
  'rolplay.pro':   'rolplay',
  'rolplay.com':   'rolplay',
  'rolplay.ai':    'rolplay',
  'rolplay.io':    'rolplay',
}

const COMPANY_DISPLAY_NAMES: Record<string, string> = {
  'coppel':  'Coppel',
  'rolplay': 'RolPlay',
}

/**
 * Detect company from email domain
 * Example: john@coppel.com → "coppel"
 */
export function detectCompanyFromEmail(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return null
  return COMPANY_DOMAIN_MAP[domain] || null
}

/**
 * Get human-readable company name
 * Example: "coppel" → "Coppel"
 */
export function getCompanyDisplayName(companyId: string): string {
  return COMPANY_DISPLAY_NAMES[companyId] || companyId
}

/**
 * Validate if email domain is known (preferred)
 */
export function isKnownDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return domain in COMPANY_DOMAIN_MAP
}

/**
 * Get list of all known domains
 */
export function getKnownDomains(): string[] {
  return Object.keys(COMPANY_DOMAIN_MAP)
}

/**
 * Add or update company domain mapping
 */
export function updateCompanyDomainMapping(domain: string, companyId: string): void {
  COMPANY_DOMAIN_MAP[domain.toLowerCase()] = companyId.toLowerCase()
}
