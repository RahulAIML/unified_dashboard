/**
 * company-mapping.ts — Email domain to company mapping
 */

const COMPANY_DOMAIN_MAP: Record<string, string> = {
  'coppel.com': 'coppel',
  'coppel.com.mx': 'coppel',
  'coppel.mx': 'coppel',
  'rolplay.pro': 'rolplay',
  'rolplay.com': 'rolplay',
}

const COMPANY_DISPLAY_NAMES: Record<string, string> = {
  'coppel': 'Coppel',
  'rolplay': 'Rolplay',
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
