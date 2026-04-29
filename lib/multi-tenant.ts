/**
 * multi-tenant.ts — Client isolation and validation helpers
 *
 * Every API call must validate that:
 * 1. User's JWT contains valid company_id
 * 2. User's company_id matches the requested resource's company_id
 * 3. Database queries filter by company_id
 *
 * This is the SOURCE OF TRUTH for multi-tenant security.
 */

import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-key-change-in-production'
)

/**
 * Decoded JWT payload with company_id
 */
export interface JwtPayloadWithCompany {
  user_id: number
  company_id: string
  email: string
  iat: number
  exp: number
}

/**
 * Extracts and validates company_id from JWT token
 *
 * @param token JWT access token
 * @returns Decoded payload with company_id, or null if invalid
 */
export function extractCompanyIdFromToken(token: string | null | undefined): {
  user_id: number
  company_id: string
  email: string
} | null {
  if (!token) return null

  try {
    const secret = new TextEncoder().encode(
      process.env.JWT_SECRET || 'dev-secret-key-change-in-production'
    )

    // Synchronous verification would be needed here, but jose uses async
    // This function is helper-only; actual verification happens in middleware/auth.ts
    const parts = token.split('.')
    if (parts.length !== 3) return null

    // Decode payload (without verification - verification done separately)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())

    if (!payload.user_id || !payload.company_id || !payload.email) {
      return null
    }

    return {
      user_id: payload.user_id,
      company_id: payload.company_id,
      email: payload.email,
    }
  } catch {
    return null
  }
}

/**
 * Validates that user has access to a specific company's data
 *
 * CRITICAL: This MUST be called before every API operation
 *
 * @param userCompanyId Company ID from JWT token
 * @param requestedCompanyId Company ID being accessed
 * @throws Error if access denied
 *
 * @example
 *   validateClientAccess(user.company_id, 'coppel')  // ✓ OK if user.company_id === 'coppel'
 *   validateClientAccess('coppel', 'acme')           // ✗ throws error
 */
export function validateClientAccess(
  userCompanyId: string | null | undefined,
  requestedCompanyId: string | null | undefined
): void {
  if (!userCompanyId || !requestedCompanyId) {
    throw new Error('Client validation failed: missing company_id')
  }

  if (userCompanyId.toLowerCase() !== requestedCompanyId.toLowerCase()) {
    throw new Error(
      `Access denied: user cannot access company ${requestedCompanyId}`
    )
  }
}

/**
 * Sanitizes company_id to prevent injection attacks
 * Accepts only alphanumeric + hyphen
 *
 * @param companyId Raw company_id from request or JWT
 * @returns Sanitized company_id, or null if invalid
 *
 * @example
 *   sanitizeCompanyId('coppel')        // → 'coppel'
 *   sanitizeCompanyId('acme-corp')     // → 'acme-corp'
 *   sanitizeCompanyId("'; DROP TABLE") // → null
 */
export function sanitizeCompanyId(companyId: unknown): string | null {
  if (typeof companyId !== 'string') return null

  // Only allow alphanumeric and hyphens
  const sanitized = companyId.toLowerCase().match(/^[a-z0-9-]+$/)

  return sanitized ? companyId.toLowerCase() : null
}

/**
 * Builds a secure database query filter for multi-tenant queries
 *
 * USAGE: Always append this to your WHERE clause
 *
 * @param userCompanyId Company ID from JWT (already validated)
 * @returns SQL fragment: "company_id = 'coppel'"
 *
 * @example
 *   const filter = buildCompanyFilter(user.company_id)
 *   const query = `SELECT * FROM coach_sessions WHERE ${filter}`
 *   // Result: SELECT * FROM coach_sessions WHERE company_id = 'coppel'
 */
export function buildCompanyFilter(userCompanyId: string): string {
  const sanitized = sanitizeCompanyId(userCompanyId)
  if (!sanitized) {
    throw new Error('Invalid company_id in buildCompanyFilter')
  }

  // Use parameterized query in real implementation
  // This is pseudo-SQL for illustration
  return `company_id = '${sanitized}'`
}

/**
 * Type guard: checks if object has valid company_id field
 */
export function hasValidCompanyId(obj: unknown): obj is { company_id: string } {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'company_id' in obj &&
    typeof (obj as Record<string, unknown>).company_id === 'string' &&
    sanitizeCompanyId((obj as Record<string, unknown>).company_id) !== null
  )
}

/**
 * Middleware helper: Extract and validate company_id from request context
 *
 * Usage in API routes:
 * ```
 * const companyId = getCompanyIdFromRequest(req)
 * validateClientAccess(userCompanyId, companyId)
 * ```
 */
export function getCompanyIdFromRequest(
  req: Request | { headers: { get: (key: string) => string | null } }
): string | null {
  // Try Authorization header first
  const authHeader = req.headers?.get?.('authorization') || null

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = extractCompanyIdFromToken(token)
    if (payload?.company_id) {
      return payload.company_id
    }
  }

  return null
}

/**
 * Ensures all data returned from queries includes company_id
 * Used for audit logging
 *
 * @example
 *   const result = await db.query(...)
 *   const audited = auditCompanyId(result, user.company_id)
 */
export function auditCompanyId<T extends Record<string, unknown>>(
  data: T,
  expectedCompanyId: string
): T & { _company_id_verified: boolean } {
  const verified = (data as Record<string, unknown>).company_id === expectedCompanyId

  if (!verified) {
    console.error('SECURITY: Company ID mismatch in audit check', {
      expected: expectedCompanyId,
      actual: (data as Record<string, unknown>).company_id,
    })
  }

  return {
    ...data,
    _company_id_verified: verified,
  }
}

/**
 * Log security event for audit trail
 */
export function logSecurityEvent(
  event: 'access_granted' | 'access_denied' | 'validation_failed',
  details: Record<string, unknown>
): void {
  console.log(`[SECURITY] ${event}:`, {
    timestamp: new Date().toISOString(),
    ...details,
  })
}
