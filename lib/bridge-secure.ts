/**
 * bridge-secure.ts — Secure PHP Bridge wrapper with company_id validation
 *
 * Every write operation (INSERT, UPDATE, DELETE) MUST:
 * 1. Validate user's company_id from JWT
 * 2. Force company_id into request data (never trust client submission)
 * 3. Call PHP bridge with company_id validation header
 * 4. Log all mutations for audit trail
 *
 * READ operations use this for consistent error handling.
 */

import { validateClientAccess, sanitizeCompanyId, logSecurityEvent } from './multi-tenant'

export type BridgeOperation = 'select' | 'insert' | 'update' | 'delete' | 'query'

export interface BridgeRequest {
  action: BridgeOperation
  table?: string
  data?: Record<string, unknown>
  conditions?: Record<string, unknown>
  query?: string
  validated_company_id: string // MUST be set by caller after validating JWT
}

export interface BridgeResponse<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: string
  affected_rows?: number
}

/**
 * Call PHP bridge with automatic company_id validation
 *
 * IMPORTANT: userCompanyId MUST be extracted from verified JWT token,
 * not from request body or query parameters.
 *
 * @param operation Operation type
 * @param userCompanyId Company ID from JWT (already validated)
 * @param config Operation-specific config
 *
 * @example
 *   // In API route handler:
 *   const userCompanyId = user.company_id  // from JWT
 *   const result = await secureBridgeCall('insert', userCompanyId, {
 *     table: 'coach_sessions',
 *     data: { user_id: 123, score: 85, result: 'Bueno' }
 *   })
 */
export async function secureBridgeCall(
  operation: BridgeOperation,
  userCompanyId: string,
  config: Omit<BridgeRequest, 'action' | 'validated_company_id'>
): Promise<BridgeResponse> {
  try {
    // Step 1: Validate company_id format
    const sanitized = sanitizeCompanyId(userCompanyId)
    if (!sanitized) {
      logSecurityEvent('validation_failed', {
        reason: 'invalid_company_id_format',
        company_id: userCompanyId,
      })
      throw new Error('Invalid company_id format')
    }

    // Step 2: For write operations, force company_id into data
    let requestData: BridgeRequest = {
      action: operation,
      ...config,
      validated_company_id: sanitized,
    }

    // For INSERT/UPDATE, always inject company_id (user cannot override)
    if ((operation === 'insert' || operation === 'update') && config.data) {
      requestData.data = {
        ...config.data,
        company_id: sanitized, // <-- FORCED, user cannot change this
      }

      logSecurityEvent('access_granted', {
        operation,
        table: config.table,
        company_id: sanitized,
        user_data_keys: Object.keys(config.data),
      })
    }

    // Step 3: Call PHP bridge
    const response = await fetch('/rolplay-bridge.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Validated-Company-ID': sanitized, // Extra validation header
      },
      body: JSON.stringify(requestData),
    })

    if (!response.ok) {
      logSecurityEvent('validation_failed', {
        reason: 'bridge_http_error',
        status: response.status,
        company_id: sanitized,
      })
      throw new Error(`Bridge HTTP ${response.status}`)
    }

    const result = (await response.json()) as BridgeResponse

    // Step 4: Verify response includes company_id (for security audit)
    if (
      (operation === 'select' || operation === 'query') &&
      result.data &&
      Array.isArray(result.data)
    ) {
      // Verify all returned rows have matching company_id
      const allRowsMatched = (result.data as unknown[]).every((row) => {
        if (typeof row === 'object' && row !== null && 'company_id' in row) {
          return (row as Record<string, unknown>).company_id === sanitized
        }
        return true // If no company_id field, skip check
      })

      if (!allRowsMatched) {
        logSecurityEvent('access_denied', {
          reason: 'response_company_id_mismatch',
          expected_company_id: sanitized,
        })
        throw new Error('Response validation failed: company_id mismatch')
      }
    }

    return result
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)

    logSecurityEvent('validation_failed', {
      reason: 'bridge_call_error',
      operation,
      error: errorMsg,
      company_id: userCompanyId,
    })

    return {
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * SELECT query with automatic company_id filtering
 *
 * @param userCompanyId Company ID from JWT
 * @param table Table name
 * @param conditions Optional WHERE conditions (will be combined with company_id filter)
 *
 * @example
 *   const sessions = await secureSelect(user.company_id, 'coach_sessions', {
 *     user_id: 123
 *   })
 *   // Executes: SELECT * FROM coach_sessions WHERE company_id = 'coppel' AND user_id = 123
 */
export async function secureSelect<T = unknown>(
  userCompanyId: string,
  table: string,
  conditions?: Record<string, unknown>
): Promise<T[]> {
  const result = await secureBridgeCall('select', userCompanyId, {
    table,
    conditions: {
      company_id: userCompanyId, // <-- Auto-filter by company_id
      ...conditions,
    },
  })

  if (!result.success || !Array.isArray(result.data)) {
    return []
  }

  return result.data as T[]
}

/**
 * INSERT with automatic company_id injection
 *
 * @param userCompanyId Company ID from JWT
 * @param table Table name
 * @param data Row data (company_id will be injected)
 *
 * @example
 *   const result = await secureInsert(user.company_id, 'coach_sessions', {
 *     user_id: 123,
 *     score: 85,
 *     result: 'Bueno'
 *   })
 *   // Inserts with company_id = 'coppel' (auto-injected from JWT)
 */
export async function secureInsert(
  userCompanyId: string,
  table: string,
  data: Record<string, unknown>
): Promise<BridgeResponse> {
  return secureBridgeCall('insert', userCompanyId, {
    table,
    data,
  })
}

/**
 * UPDATE with automatic company_id filtering and validation
 *
 * @param userCompanyId Company ID from JWT
 * @param table Table name
 * @param data Updated fields (company_id in data will be ignored/overridden)
 * @param conditions WHERE conditions (company_id filter auto-added)
 *
 * @example
 *   const result = await secureUpdate(user.company_id, 'coach_sessions', {
 *     result: 'Deficiente'
 *   }, {
 *     id: 123
 *   })
 *   // Updates only if id=123 AND company_id='coppel'
 */
export async function secureUpdate(
  userCompanyId: string,
  table: string,
  data: Record<string, unknown>,
  conditions?: Record<string, unknown>
): Promise<BridgeResponse> {
  return secureBridgeCall('update', userCompanyId, {
    table,
    data,
    conditions: {
      company_id: userCompanyId,
      ...conditions,
    },
  })
}

/**
 * DELETE with automatic company_id filtering
 *
 * @param userCompanyId Company ID from JWT
 * @param table Table name
 * @param conditions WHERE conditions (company_id filter auto-added)
 *
 * @example
 *   const result = await secureDelete(user.company_id, 'user_sessions', {
 *     token_jti: 'abc123'
 *   })
 *   // Deletes only if company_id='coppel' AND token_jti='abc123'
 */
export async function secureDelete(
  userCompanyId: string,
  table: string,
  conditions?: Record<string, unknown>
): Promise<BridgeResponse> {
  return secureBridgeCall('delete', userCompanyId, {
    table,
    conditions: {
      company_id: userCompanyId,
      ...conditions,
    },
  })
}

/**
 * Raw query execution (for complex queries)
 * MUST be used carefully - caller is responsible for adding company_id filter
 *
 * @param userCompanyId Company ID from JWT (for logging/validation)
 * @param query SQL query (CALLER MUST INCLUDE company_id filter)
 *
 * @example
 *   const query = `
 *     SELECT * FROM coach_sessions
 *     WHERE company_id = $1 AND date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
 *   `
 *   const result = await secureQuery(user.company_id, query)
 */
export async function secureQuery(userCompanyId: string, query: string): Promise<BridgeResponse> {
  // Verify query contains company_id filter (basic string check)
  if (!query.toLowerCase().includes('company_id')) {
    logSecurityEvent('validation_failed', {
      reason: 'query_missing_company_id_filter',
      company_id: userCompanyId,
    })
    throw new Error('Query must include company_id filter for security')
  }

  return secureBridgeCall('query', userCompanyId, {
    query,
  })
}
