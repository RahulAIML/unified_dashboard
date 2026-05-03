/**
 * API endpoint to check Second Brain access
 * For debugging and testing purposes
 */

import { NextRequest, NextResponse } from 'next/server'
import { fetchSecondBrainProfile, fetchSecondBrainProfileByOrgName } from '@/lib/second-brain-api'

export async function GET(request: NextRequest) {
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
