/**
 * /api/second-brain/profile
 *
 * Server-side proxy for the Second Brain hosted API.
 * Credentials (URL + admin email) live ONLY in .env.local — never sent to
 * the browser, never committed to git.
 *
 * Response shape from upstream:
 *   { organization: { ... }, courses: [...], users: [...], ... }
 *
 * We re-wrap in the standard { success, data, meta } envelope so the
 * client-side useApi() hook works out-of-the-box with no changes.
 */

import { NextResponse } from "next/server"

const SECOND_BRAIN_API_URL   = process.env.SECOND_BRAIN_API_URL
const SECOND_BRAIN_ADMIN_EMAIL = process.env.SECOND_BRAIN_ADMIN_EMAIL

export const dynamic = "force-dynamic"

export async function GET() {
  if (!SECOND_BRAIN_API_URL || !SECOND_BRAIN_ADMIN_EMAIL) {
    return NextResponse.json(
      { success: false, data: { message: "Second Brain API is not configured" }, meta: {} },
      { status: 503 }
    )
  }

  try {
    const url = new URL(`${SECOND_BRAIN_API_URL}/organizations/full-profile`)
    url.searchParams.set("admin_email", SECOND_BRAIN_ADMIN_EMAIL)

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      // Render free tier can be slow to cold-start — give it 20 s
      signal: AbortSignal.timeout(20_000),
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "")
      console.error("[/api/second-brain/profile] upstream error", upstream.status, text)
      return NextResponse.json(
        {
          success: false,
          data: { message: `Second Brain API error: ${upstream.status}` },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: upstream.status }
      )
    }

    const rawData = await upstream.json()

    return NextResponse.json({
      success: true,
      data: rawData,
      meta: {
        source: "second-brain-api",
        timestamp: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error("[/api/second-brain/profile]", err)
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json(
      {
        success: false,
        data: { message: `Failed to reach Second Brain API: ${message}` },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 502 }
    )
  }
}
