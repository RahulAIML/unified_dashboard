/**
 * multi-source-auth.ts — Check user access across multiple data sources
 * 
 * Instead of blocking users who lack DB records, we now allow partial access:
 * - Users can access Coach module if they have DB records (customer_id > 0)
 * - Users can access Second Brain if they have API records (admin_email registered)
 * - Users with neither get a helpful message, not a hard block
 */

import { fetchSecondBrainProfile } from './second-brain-api'

export interface AccessStatus {
  /** User has DB records (coach_app) */
  hasCoachData: boolean
  /** User has Second Brain API records */
  hasSecondBrainData: boolean
  /** Overall: user has access to at least one module */
  hasAnyAccess: boolean
}

/**
 * Check user access across all data sources
 * 
 * @param customerId - DB customer ID (0 = not linked to org)
 * @param email - User email (for Second Brain API lookup)
 */
export async function getAccessStatus(
  customerId: number,
  email: string
): Promise<AccessStatus> {
  const hasCoachData = customerId > 0

  let hasSecondBrainData = false
  try {
    // Try to fetch Second Brain profile using email
    const profile = await fetchSecondBrainProfile(email)
    hasSecondBrainData = profile !== null
  } catch {
    // API error or not configured — assume no access
    hasSecondBrainData = false
  }

  return {
    hasCoachData,
    hasSecondBrainData,
    hasAnyAccess: hasCoachData || hasSecondBrainData,
  }
}

/**
 * User-friendly message based on access status
 */
export function getAccessMessage(status: AccessStatus): {
  title: string
  subtitle: string
  cta?: string
} {
  if (status.hasAnyAccess) {
    // User has access to something — no block needed
    return {
      title: 'Partial Access',
      subtitle: 'Some modules are unavailable for your account',
    }
  }

  // User has no access anywhere
  return {
    title: 'No Access',
    subtitle: 'Your account is not linked to any organization or Second Brain workspace. Contact your administrator to get started.',
    cta: 'Contact Support',
  }
}
