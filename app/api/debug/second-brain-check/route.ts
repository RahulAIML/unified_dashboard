/**
 * API endpoint to check Second Brain access
 * For debugging and testing purposes
 *
 * ADMIN ONLY. This takes an arbitrary ?email= or ?org= and returns that
 * subject's Second Brain profile, so while unauthenticated it was a
 * cross-tenant data disclosure: anyone who could guess or enumerate an address
 * could read another customer's profile. "Debug endpoint" is not a scope —
 * it ships in the same bundle as everything else.
 *
 * Kept rather than deleted because it is genuinely useful for diagnosing
 * onboarding, but it must never be reachable without an admin session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchSecondBrainProfile, fetchSecondBrainProfileByOrgName } from '@/lib/second-brain-api'
import { requireAdminFromRequest } from '@/lib/server-auth'

export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const email = request.nextUrl.searchParams.get('email')
    const orgName = request.nextUrl.searchParams.get('org')

    if (!email && !orgName) {
      return NextResponse.json(
        { error: 'Provide either email or org query parameter' },
        { status: 400 }
      )
    }

    let result = null
    let method = ''

    if (email) {
      method = 'email lookup'
      console.log(`[API] Second Brain check for email: ${email}`)
      result = await fetchSecondBrainProfile(email)

      // If email fails, try to extract org name from email
      if (!result) {
        const extractedOrg = email.match(/@([^.]+)\./)?.[1]
        if (extractedOrg) {
          console.log(`[API] Email failed, trying extracted org: ${extractedOrg}`)
          method = `email lookup + org fallback (${extractedOrg})`
          result = await fetchSecondBrainProfileByOrgName(extractedOrg)
        }
      }
    } else if (orgName) {
      method = 'org name lookup'
      console.log(`[API] Second Brain check for org: ${orgName}`)
      result = await fetchSecondBrainProfileByOrgName(orgName)
    }

    return NextResponse.json({
      success: result !== null,
      method,
      data: result,
    })
  } catch (err) {
    console.error('[API] Second Brain check error:', err)
    return NextResponse.json(
      { 
        error: err instanceof Error ? err.message : 'Unknown error',
        stack: process.env.NODE_ENV === 'development' ? err instanceof Error ? err.stack : 'N/A' : undefined,
      },
      { status: 500 }
    )
  }
}
