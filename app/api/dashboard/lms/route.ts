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
import { useDemoData } from '@/lib/demo'
import { demoLms } from '@/lib/demo/engine'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  const range = parseDateRange(request.nextUrl.searchParams)
  if (!range) return buildApiError('Invalid or missing from/to date range', 400)
  const { from, to } = range

  if (useDemoData(ctx.email)) {
    return buildSuccess(demoLms(from, to), { source: 'demo' })
  }

  try {
    // The LMS is keyed by tenant so a second client with its own LearnWorlds
    // school works via env config alone (LMS_<TENANT>_*), with no code change.
    const orgType = await resolveOrgType(ctx.email, ctx.customerId)
    const tenantKey = orgType === 'pharma' ? await resolvePharmaTenant(ctx.email) : null

    const data = await lmsDashboard(tenantKey, from, to)

    // Name the exact env vars that were looked for and did not resolve. Without
    // this, an unconfigured LMS is indistinguishable from a misnamed variable or
    // a tenant key that is not what you assumed — which is exactly the guessing
    // this endpoint should make unnecessary. Values are never logged.
    if (!data.configured) {
      const prefix = tenantKey ? lmsEnvPrefix(tenantKey) : 'LMS'
      console.warn(
        `[/api/dashboard/lms] not configured for tenantKey=${tenantKey ?? '(none)'} ` +
        `orgType=${orgType}. Looked for ${prefix}_API_URL plus either ` +
        `${prefix}_ACCESS_TOKEN or (${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET). ` +
        `Present: ${['API_URL', 'ACCESS_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET']
          .map(s => `${s}=${process.env[`${prefix}_${s}`] ? 'yes' : 'no'}`)
          .join(' ')}`,
      )
    }

    return buildSuccess(data, {
      source: data.configured ? `lms-${tenantKey ?? 'default'}` : 'lms-not-configured',
      orgType,
      // Surfaced so the tenant key can be confirmed from the response itself.
      tenantKey: tenantKey ?? null,
      lmsEnvPrefix: tenantKey ? lmsEnvPrefix(tenantKey) : 'LMS',
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
