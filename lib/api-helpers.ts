/**
 * api-helpers.ts — Safe extraction of user context from API requests
 *
 * Every API route handler should:
 * 1. Call getCompanyIdFromRequest() to get authenticated user's company_id
 * 2. Validate it's present and valid
 * 3. Pass it to database functions
 * 4. Use secure bridge functions that filter by company_id
 */

import { NextRequest } from 'next/server'
import { validateClientAccess, logSecurityEvent } from './multi-tenant'

export interface ApiContext {
  userId: number
  companyId: string
  email: string
}

/**
 * Extract user context from request headers (set by middleware)
 *
 * Middleware adds these headers after validating JWT:
 * - x-user-id: User ID
 * - x-user-company: Company ID (from JWT)
 * - x-user-company-id: Sanitized company ID
 *
 * @param request NextRequest object
 * @returns User context or null if missing
 *
 * @example
 *   export async function GET(req: NextRequest) {
 *     const context = getApiContext(req)
 *     if (!context) {
 *       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *     }
 *     // Now safe to use context.companyId in queries
 *   }
 */
export function getApiContext(request: NextRequest): ApiContext | null {
  const userId = request.headers.get('x-user-id')
  const companyId = request.headers.get('x-user-company-id') // Use sanitized version
  const email = request.headers.get('x-user-email')

  if (!userId || !companyId) {
    logSecurityEvent('validation_failed', {
      reason: 'missing_api_context_headers',
      has_user_id: !!userId,
      has_company_id: !!companyId,
    })
    return null
  }

  const userIdNum = parseInt(userId, 10)
  if (isNaN(userIdNum)) {
    logSecurityEvent('validation_failed', {
      reason: 'invalid_user_id_format',
    })
    return null
  }

  return {
    userId: userIdNum,
    companyId,
    email: email || 'unknown',
  }
}

/**
 * Helper: Validate request body contains only allowed fields
 * Prevents injection of unwanted fields like company_id
 *
 * @param body Request body data
 * @param allowedFields Array of field names allowed in request
 * @returns Sanitized body with only allowed fields
 *
 * @example
 *   const body = await req.json()
 *   const clean = validateRequestBody(body, ['score', 'result', 'date'])
 *   // Result only contains score, result, date
 */
export function validateRequestBody(
  body: Record<string, unknown>,
  allowedFields: string[]
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  for (const field of allowedFields) {
    if (field in body) {
      sanitized[field] = body[field]
    }
  }

  return sanitized
}

/**
 * Helper: Ensure query string parameters don't contain company_id override
 *
 * @param url URL object
 * @returns Sanitized search params without company_id
 */
export function getSafeQueryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {}

  for (const [key, value] of url.searchParams.entries()) {
    // Never allow overriding company_id from query string
    if (key.toLowerCase() !== 'company_id' && key.toLowerCase() !== 'companyid') {
      params[key] = value
    }
  }

  return params
}

/**
 * Response wrapper: Add audit headers to response
 */
export function withAuditHeaders(
  response: Response,
  context: ApiContext
): Response {
  response.headers.set('x-audit-user-id', context.userId.toString())
  response.headers.set('x-audit-company-id', context.companyId)
  return response
}

/**
 * Type guard: Check if object is valid ApiContext
 */
export function isValidApiContext(obj: unknown): obj is ApiContext {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'userId' in obj &&
    'companyId' in obj &&
    typeof (obj as Record<string, unknown>).userId === 'number' &&
    typeof (obj as Record<string, unknown>).companyId === 'string'
  )
}
