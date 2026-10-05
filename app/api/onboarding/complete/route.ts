/**
 * POST /api/onboarding/complete
 *
 * Marks the first-time guided tour dismissed for the authenticated user --
 * called both when the tour is finished (last step's CTA) and when it's
 * skipped (both cases must never auto-show the tour again, per spec).
 * Idempotent: also called again after a manual "Replay guided tour" from
 * Settings, once THAT run is dismissed too.
 */
import { NextRequest } from 'next/server'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { completeOnboarding, DbError } from '@/lib/db-users'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError('Unauthorized', 401)

  try {
    await completeOnboarding(ctx.userId)
    return buildSuccess({ onboarding_completed_at: new Date().toISOString() })
  } catch (err) {
    if (err instanceof DbError) {
      console.error('[/api/onboarding/complete] DB error:', err.code, err.message)
      return buildApiError('Could not save onboarding state right now.', 503)
    }
    console.error('[/api/onboarding/complete] Unhandled error:', err)
    return buildApiError('Something went wrong. Please try again.', 500)
  }
}
