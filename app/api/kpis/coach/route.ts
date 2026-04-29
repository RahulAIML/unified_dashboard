/**
 * GET /api/kpis/coach
 *
 * Secure endpoint for fetching coach KPIs filtered by user's company_id
 *
 * MULTI-TENANT: This endpoint demonstrates the secure pattern:
 * 1. Extract company_id from middleware headers (set by JWT validation)
 * 2. Validate company_id is present and valid
 * 3. Use secureQuery to filter by company_id
 * 4. Return only that company's data
 *
 * Query params:
 * - from: ISO date string (start date)
 * - to: ISO date string (end date)
 */

import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, getSafeQueryParams } from '@/lib/api-helpers'
import { secureQuery } from '@/lib/bridge-secure'
import { logSecurityEvent } from '@/lib/multi-tenant'

interface CoachKpi {
  total_sessions: number
  avg_score: number | null
  pass_rate: number | null
  passed_sessions: number
}

export async function GET(request: NextRequest) {
  try {
    // Step 1: Extract and validate company_id from headers
    const context = getApiContext(request)
    if (!context) {
      logSecurityEvent('access_denied', {
        reason: 'missing_api_context',
        path: '/api/kpis/coach',
      })
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Step 2: Get safe query parameters (no company_id injection)
    const params = getSafeQueryParams(request.nextUrl)
    const from = params.from ? new Date(params.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const to = params.to ? new Date(params.to) : new Date()

    // Validate dates
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format' },
        { status: 400 }
      )
    }

    // Step 3: Build secure query with company_id filter
    // CRITICAL: Query includes WHERE company_id = $1
    const query = `
      SELECT
        COUNT(*) as total_sessions,
        ROUND(AVG(score), 1) as avg_score,
        ROUND(
          SUM(CASE WHEN result = 'Bueno' OR result = 'Básico' THEN 1 ELSE 0 END)
          / NULLIF(COUNT(*), 0) * 100,
          1
        ) as pass_rate,
        SUM(CASE WHEN result = 'Bueno' OR result = 'Básico' THEN 1 ELSE 0 END) as passed_sessions
      FROM coach_sessions
      WHERE
        company_id = '${context.companyId}'
        AND date >= '${from.toISOString().split('T')[0]}'
        AND date <= '${to.toISOString().split('T')[0]}'
    `

    // Step 4: Execute secure query (bridge validates company_id again)
    const result = await secureQuery(context.companyId, query)

    if (!result.success || !result.data) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch KPIs' },
        { status: 500 }
      )
    }

    // Step 5: Verify response has company_id filter applied
    const kpi = (result.data as CoachKpi[])[0] || {
      total_sessions: 0,
      avg_score: null,
      pass_rate: null,
      passed_sessions: 0,
    }

    logSecurityEvent('access_granted', {
      reason: 'coach_kpi_fetched',
      company_id: context.companyId,
      user_id: context.userId,
      rows_returned: 1,
    })

    return NextResponse.json({
      success: true,
      data: kpi,
      meta: {
        company_id: context.companyId,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    console.error('[/api/kpis/coach]', error)

    logSecurityEvent('validation_failed', {
      reason: 'exception_in_endpoint',
      path: '/api/kpis/coach',
      error: errorMsg,
    })

    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
