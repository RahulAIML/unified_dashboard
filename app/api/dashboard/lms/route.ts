/**
 * GET /api/dashboard/lms
 *
 * The LMS module's own endpoint. It exists because LMS metrics (enrollments,
 * completion rate, quiz scores) are a different measurement from evaluation
 * sessions — routing /lms through /api/dashboard/overview is what previously
 * made Simulator numbers appear under an LMS label.
 *
 * Returns `configured: false` (all metrics null/zero) when the tenant has no
 * LMS credentials, so the UI renders an honest empty state instead of implying
 * an LMS exists with no activity.
 */

import { NextRequest } from 'next/server'
import { buildSuccess, buildApiError, parseDateRange } from '@/lib/api-utils'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType } from '@/lib/org-type'
import { resolvePharmaTenant } from '@/lib/pharma-tenant'
import { lmsDashboard, lmsEnvPrefix } from '@/lib/lms-learnworlds'
import { diagnoseTenantCredentials } from '@/lib/tenant-credentials'
import { isDemoDataEnabled } from '@/lib/demo'
import { demoLms } from '@/lib/demo/engine'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  const range = parseDateRange(request.nextUrl.searchParams)
  if (!range) return buildApiError('Invalid or missing from/to date range', 400)
  const { from, to } = range

  if (isDemoDataEnabled(ctx.email)) {
    return buildSuccess(demoLms(from, to), { source: 'demo' })
  }

  try {
    // The LMS is keyed by tenant so a second client with its own LearnWorlds
    // school works via env config alone (LMS_<TENANT>_*), with no code change.
    const orgType = await resolveOrgType(ctx.email, ctx.customerId)
    const tenantKey = orgType === 'pharma' ? await resolvePharmaTenant(ctx.email) : null

    const data = await lmsDashboard(tenantKey, from, to)

    // Full per-field diagnosis whenever unconfigured: which fields resolved
    // from the DB store, which from env, which are missing entirely, and
    // whether the DB itself was even reachable. Previously "not configured"
    // could mean any of: no DB row, DB unreachable, env var misnamed, or a
    // tenant key that isn't what you assumed — all indistinguishable from the
    // outside, each needing a different fix. Values are never included.
    let diagnostic: Awaited<ReturnType<typeof diagnoseTenantCredentials>> | undefined
    if (!data.configured) {
      diagnostic = await diagnoseTenantCredentials(
        tenantKey, 'lms', tenantKey ? lmsEnvPrefix(tenantKey) : 'LMS',
        ['api_url', 'client_id', 'client_secret', 'access_token'],
      )
      console.warn(
        `[/api/dashboard/lms] not configured for tenantKey=${tenantKey ?? '(none)'} ` +
        `orgType=${orgType} dbReachable=${diagnostic.dbReachable} fields=${JSON.stringify(diagnostic.fields)}`,
      )
    }

    return buildSuccess(data, {
      source: data.configured ? `lms-${tenantKey ?? 'default'}` : 'lms-not-configured',
      orgType,
      // Surfaced so the tenant key can be confirmed from the response itself.
      tenantKey: tenantKey ?? null,
      lmsEnvPrefix: tenantKey ? lmsEnvPrefix(tenantKey) : 'LMS',
      ...(diagnostic ? { diagnostic } : {}),
    })
  } catch (err) {
    console.error('[/api/dashboard/lms]', err)
    // Surface the failure rather than passing zeros off as real LMS data.
    return buildApiError(
      err instanceof Error ? err.message : 'LMS request failed',
      502,
    )
  }
}
