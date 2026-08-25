/**
 * GET /api/dashboard/journey-bookends
 *
 * The Journey's "Initial Diagnostic" and "Final Exam" bookend stages. No
 * real diagnostic/final-exam data source exists anywhere in this platform
 * yet -- real mode honestly returns null for both rather than fabricating
 * a number the platform never recorded. Demo mode returns the isolated mock
 * data from lib/demo/journey-bookends.ts (never contaminating the real
 * Rolplay SQL-backed data layer).
 *
 * FUTURE MIGRATION: once a real diagnostic/final-exam source exists, only
 * the real-mode branch below needs to change (call it instead of returning
 * null) -- app/journey/page.tsx already renders this exact shape and needs
 * no changes.
 */
import { NextRequest } from "next/server"
import { buildSuccess, buildApiError } from "@/lib/api-utils"
import { getAuthContextFromRequest } from "@/lib/server-auth"
import { isDemoDataEnabled } from "@/lib/demo"
import { demoJourneyBookends, type JourneyBookend } from "@/lib/demo/journey-bookends"

export const runtime = "nodejs"

export interface JourneyBookendsApiResponse {
  diagnostic: JourneyBookend | null
  finalExam: JourneyBookend | null
}

export async function GET(request: NextRequest) {
  const ctx = await getAuthContextFromRequest(request)
  if (!ctx) return buildApiError("Unauthorized", 401)

  if (isDemoDataEnabled(ctx.email)) {
    const { diagnostic, finalExam } = demoJourneyBookends()
    return buildSuccess<JourneyBookendsApiResponse>({ diagnostic, finalExam }, { source: "demo" })
  }

  // Honest "not available" -- no real diagnostic/final-exam source exists
  // yet. Never fabricate a score here just because the demo has one.
  return buildSuccess<JourneyBookendsApiResponse>(
    { diagnostic: null, finalExam: null },
    { source: "not-configured" },
  )
}
