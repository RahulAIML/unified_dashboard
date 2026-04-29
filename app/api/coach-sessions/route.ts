/**
 * POST /api/coach-sessions
 *
 * Secure endpoint for recording a coach session with automatic company_id injection
 *
 * MULTI-TENANT: This endpoint demonstrates secure write pattern:
 * 1. Extract company_id from middleware headers
 * 2. Validate request body (only allowed fields)
 * 3. Force company_id into data (user cannot override)
 * 4. Use secureInsert to inject company_id automatically
 * 5. PHP bridge validates company_id again
 *
 * Request body:
 * {
 *   "user_id": 123,
 *   "score": 85,
 *   "result": "Bueno",
 *   "date": "2026-04-29"
 * }
 *
 * Response: { success: true, session_id: 999, company_id: "coppel" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, validateRequestBody } from '@/lib/api-helpers'
import { secureInsert } from '@/lib/bridge-secure'
import { logSecurityEvent } from '@/lib/multi-tenant'

export async function POST(request: NextRequest) {
  try {
    // Step 1: Extract and validate company_id from headers
    const context = getApiContext(request)
    if (!context) {
      logSecurityEvent('access_denied', {
        reason: 'missing_api_context',
        path: '/api/coach-sessions',
        method: 'POST',
      })
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Step 2: Parse and validate request body
    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON' },
        { status: 400 }
      )
    }

    // Step 3: Validate only allowed fields
    // This prevents user from injecting company_id or other system fields
    const allowedFields = ['user_id', 'score', 'result', 'date', 'notes']
    const cleanBody = validateRequestBody(body, allowedFields)

    // Step 4: Validate required fields
    if (!cleanBody.user_id || !cleanBody.score || !cleanBody.result) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: user_id, score, result' },
        { status: 400 }
      )
    }

    // Step 5: Validate field types
    const userId = Number(cleanBody.user_id)
    const score = Number(cleanBody.score)
    const result = String(cleanBody.result)

    if (isNaN(userId) || isNaN(score)) {
      return NextResponse.json(
        { success: false, error: 'Invalid user_id or score format' },
        { status: 400 }
      )
    }

    if (!['Bueno', 'Básico', 'Deficiente'].includes(result)) {
      return NextResponse.json(
        { success: false, error: 'Invalid result value' },
        { status: 400 }
      )
    }

    // Step 6: Use secureInsert (automatically injects company_id)
    // User CANNOT override company_id - it's always set to their authenticated company
    const insertResult = await secureInsert(context.companyId, 'coach_sessions', {
      user_id: userId,
      score,
      result,
      date: cleanBody.date || new Date().toISOString().split('T')[0],
      notes: cleanBody.notes || null,
      // company_id is automatically injected by secureInsert
    })

    if (!insertResult.success) {
      logSecurityEvent('validation_failed', {
        reason: 'insert_failed',
        path: '/api/coach-sessions',
        company_id: context.companyId,
        error: insertResult.error,
      })

      return NextResponse.json(
        { success: false, error: 'Failed to insert session' },
        { status: 500 }
      )
    }

    // Step 7: Log successful write
    logSecurityEvent('access_granted', {
      reason: 'coach_session_created',
      company_id: context.companyId,
      user_id: context.userId,
      inserted_user_id: userId,
      affected_rows: insertResult.affected_rows,
    })

    return NextResponse.json({
      success: true,
      data: {
        session_id: (insertResult.data as any)?.insertId || null,
        company_id: context.companyId,
        user_id: userId,
      },
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[/api/coach-sessions]', error)

    logSecurityEvent('validation_failed', {
      reason: 'exception_in_endpoint',
      path: '/api/coach-sessions',
      method: 'POST',
      error: errorMsg,
    })

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
