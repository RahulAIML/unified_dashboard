/**
 * GET /api/admin/export — internal/admin CSV export of raw, per-interaction
 * dashboard data. NOT a client-facing feature: gated behind requireAdminFromRequest,
 * the same admin-only check every other tenant-provisioning/inspection route in
 * this codebase uses (app/api/ai/known-companies/route.ts, app/api/admin/tenants).
 * A regular tenant user can never reach this, regardless of their own org type.
 *
 * Every module here maps to a REAL, already-verified data source -- nothing
 * invented for this endpoint:
 *   - coach / simulator / certification / other -> rolplay_app_sql, one row
 *     per real r_user_session (lib/bridge-rolplay-app.ts's
 *     rolplayAppRawInteractions), scoped by the platform's own
 *     r_simulator.category. Rolplay App SQL is the PRIMARY source here
 *     because it's the only one of these four that genuinely has this data
 *     at the per-interaction level.
 *   - lms -> LearnWorlds (lib/lms-learnworlds.ts's lmsRawProgressRows),
 *     because rolplay_app_sql has NO LMS concept at all (confirmed live: no
 *     LMS category exists in r_simulator.category) -- using rolplay_app_sql
 *     here would mean inventing a relationship that doesn't exist. This is
 *     the one module where a DIFFERENT real source is correctly primary.
 *
 * Query params:
 *   module    required: 'lms' | 'coach' | 'simulator' | 'certification' | 'other'
 *   clientId  rolplay_app_sql client id -- required for coach/simulator/certification/other
 *   tenant    pharma tenant key -- required for lms (identifies the LearnWorlds school)
 *   from/to   optional ISO date range (coach/simulator/certification/other only;
 *             LMS is a current-state roster export, not date-filtered, matching
 *             lmsDashboard's own "an LMS roster is a snapshot" rule)
 *   limit     optional row cap (coach/simulator/certification/other only), default 5000
 *
 * Tenant isolation: identical to every other rolplay_app_sql/pharma query in
 * this codebase -- clientId/tenant scope every row via the SAME WHERE clauses
 * the dashboard itself uses (u.client_id = ..., resolveLmsCredentialsAsync's
 * tenant-scoped credential lookup). No cross-tenant join is possible because
 * none of the underlying functions accept more than one tenant at a time.
 *
 * No secrets in the response: rows carry business data only (session/user/
 * score fields) -- no API keys, tokens, or credentials, and no raw SQL
 * connection details are ever echoed back.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit'
import { rolplayAppRawInteractions, type RawInteractionModule } from '@/lib/bridge-rolplay-app'
import { lmsRawProgressRows } from '@/lib/lms-learnworlds'
import { buildCsv, csvFilename, type CsvColumn } from '@/lib/csv-export'

export const runtime = 'nodejs'

const EXPORT_LIMIT = 60
const EXPORT_WINDOW_MS = 60_000

const MODULE_TO_CATEGORY: Record<'coach' | 'simulator' | 'certification' | 'other', RawInteractionModule> = {
  coach: 'COACH', simulator: 'SIM', certification: 'SEGMENT', other: 'OTHER',
}

const INTERACTION_COLUMNS: CsvColumn<Awaited<ReturnType<typeof rolplayAppRawInteractions>>[number]>[] = [
  { header: 'session_id', value: r => r.session_id },
  { header: 'client_id', value: r => r.client_id },
  { header: 'module_category', value: r => r.module_category },
  { header: 'date_created', value: r => r.date_created },
  { header: 'user_id', value: r => r.user_id },
  { header: 'user_name', value: r => r.user_name },
  { header: 'user_email', value: r => r.user_email },
  { header: 'user_department', value: r => r.user_department },
  { header: 'user_designation', value: r => r.user_designation },
  { header: 'simulator_id', value: r => r.simulator_id },
  { header: 'simulator_name', value: r => r.simulator_name },
  { header: 'score', value: r => r.score },
  { header: 'score_source', value: r => r.score_source },
  { header: 'result', value: r => r.result },
  { header: 'legacy_score', value: r => r.legacy_score },
  { header: 'legacy_passed_flag', value: r => r.legacy_passed_flag },
  { header: 'rating_score', value: r => r.rating_score },
  { header: 'interaction_type', value: r => r.interaction_type },
]

const LMS_COLUMNS: CsvColumn<Awaited<ReturnType<typeof lmsRawProgressRows>>[number]>[] = [
  { header: 'tenant', value: r => r.tenant },
  { header: 'user_id', value: r => r.user_id },
  { header: 'user_name', value: r => r.user_name },
  { header: 'user_email', value: r => r.user_email },
  { header: 'course_id', value: r => r.course_id },
  { header: 'course_title', value: r => r.course_title },
  { header: 'status', value: r => r.status },
  { header: 'progress_rate', value: r => r.progress_rate },
  { header: 'average_score_rate', value: r => r.average_score_rate },
  { header: 'total_units', value: r => r.total_units },
  { header: 'completed_units', value: r => r.completed_units },
  { header: 'time_on_course', value: r => r.time_on_course },
  { header: 'completed_at', value: r => r.completed_at },
]

export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const limit = rateLimit(`admin-export:${admin.email}`, EXPORT_LIMIT, EXPORT_WINDOW_MS)
  if (!limit.ok) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: rateLimitHeaders(limit) })
  }

  const sp = request.nextUrl.searchParams
  const module = sp.get('module')

  // Audit trail: this endpoint reads real per-user session/progress data, so
  // who exported what must be recoverable -- params only, never row contents.
  console.info(`[audit] admin-export admin=${admin.email} module=${module} clientId=${sp.get('clientId')} tenant=${sp.get('tenant')}`)

  try {
    if (module === 'lms') {
      const tenant = sp.get('tenant')
      if (!tenant) return NextResponse.json({ error: 'tenant is required for module=lms' }, { status: 400 })
      const rows = await lmsRawProgressRows(tenant)
      const csv = buildCsv(rows, LMS_COLUMNS)
      return csvResponse(csv, csvFilename(`export-lms-${tenant}`))
    }

    if (module === 'coach' || module === 'simulator' || module === 'certification' || module === 'other') {
      const clientIdParam = sp.get('clientId')
      const clientId = clientIdParam ? Number(clientIdParam) : NaN
      if (!Number.isFinite(clientId) || clientId <= 0) {
        return NextResponse.json({ error: 'a valid numeric clientId is required for this module' }, { status: 400 })
      }
      const fromIso = sp.get('from')
      const toIso = sp.get('to')
      const range = fromIso && toIso ? { fromIso, toIso } : undefined
      const limitParam = sp.get('limit')
      const rowLimit = limitParam ? Math.max(1, Math.min(20000, Number(limitParam) || 5000)) : 5000

      const rows = await rolplayAppRawInteractions(clientId, MODULE_TO_CATEGORY[module], range, rowLimit)
      const csv = buildCsv(rows, INTERACTION_COLUMNS)
      return csvResponse(csv, csvFilename(`export-${module}-${clientId}`))
    }

    if (module === null) {
      return NextResponse.json(
        { error: "module is required: one of 'lms', 'coach', 'simulator', 'certification', 'other'" },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: `unknown module '${module}'` }, { status: 400 })
  } catch (err) {
    // Never leak the underlying error message verbatim -- it can carry the
    // upstream SQL/LMS endpoint's own response text, which this route must
    // not echo back (defence in depth alongside the credentials never being
    // logged anywhere in lib/bridge-rolplay-app.ts / lib/lms-learnworlds.ts).
    console.error('[/api/admin/export]', err)
    return NextResponse.json({ error: 'Failed to build export' }, { status: 500 })
  }
}

function csvResponse(csv: string, filename: string): NextResponse {
  return new NextResponse('﻿' + csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

