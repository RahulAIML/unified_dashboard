/**
 * /api/second-brain/profile
 *
 * Tenant-isolated server-side proxy for the Second Brain hosted API.
 * Credentials remain server-side only and are resolved per customer.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAuthContextFromRequest } from "@/lib/server-auth"
import { getTenantIntegration } from "@/lib/db-tenant-integrations"
import { secondBrainAdminCandidates } from "@/lib/banco-second-brain"
import { isDemoMode } from "@/lib/demo"
import { demoSecondBrainProfile } from "@/lib/demo/engine"

const SECOND_BRAIN_API_URL = process.env.SECOND_BRAIN_API_URL
const SECOND_BRAIN_API_TOKEN = process.env.SECOND_BRAIN_API_TOKEN

export const dynamic = "force-dynamic"

function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ""
  const digits = phone.replace(/\D/g, "")
  if (digits.length <= 2) return digits
  return `${"X".repeat(Math.max(digits.length - 2, 4))}${digits.slice(-2)}`
}

function maskPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(maskPayload)
  if (!payload || typeof payload !== "object") return payload

  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (key === "phone_number" || key === "whatsapp_number") {
      next[key] = maskPhone(typeof value === "string" ? value : "")
    } else {
      next[key] = maskPayload(value)
    }
  }
  return next
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContextFromRequest(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, data: { message: "Unauthorized" }, meta: {} },
      { status: 401 }
    )
  }

  // ── DEMO MODE ──────────────────────────────────────────────────────────────
  if (isDemoMode()) {
    return NextResponse.json({
      success: true,
      data: demoSecondBrainProfile(),
      meta: { timestamp: new Date().toISOString(), source: 'demo' },
    })
  }

  if (!SECOND_BRAIN_API_URL) {
    return NextResponse.json(
      { success: false, data: { message: "Second Brain API is not configured" }, meta: {} },
      { status: 503 }
    )
  }

  try {
    const integration = await getTenantIntegration(auth.customerId)
    const apiToken = integration?.second_brain_api_token || SECOND_BRAIN_API_TOKEN

    // Try each candidate admin_email in order (tenant integration → derived
    // admin@{domain} → env fallback) and use the FIRST that resolves upstream.
    // The derived admin@{domain} frequently 404s (e.g. Second Brain's coppel
    // org is owned by admin1@coppel.com), so falling through to the env
    // fallback is what actually makes the page work for those tenants.
    const candidates = await secondBrainAdminCandidates(auth.email, auth.customerId)

    if (candidates.length === 0) {
      return NextResponse.json(
        { success: false, data: { message: "Second Brain integration is not configured for this customer" }, meta: {} },
        { status: 404 }
      )
    }

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
    }

    let lastStatus = 502
    for (const adminEmail of candidates) {
      const url = new URL(`${SECOND_BRAIN_API_URL}/organizations/full-profile`)
      url.searchParams.set("admin_email", adminEmail)

      const upstream = await fetch(url.toString(), {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      }).catch(() => null)

      if (!upstream) { lastStatus = 502; continue }
      if (!upstream.ok) { lastStatus = upstream.status; continue }

      const rawData = await upstream.json()
      const maskedData = maskPayload(rawData)
      return NextResponse.json({
        success: true,
        data: maskedData,
        meta: { source: "second-brain-api", timestamp: new Date().toISOString(), adminEmail },
      })
    }

    // No candidate resolved. Map upstream 404 (org not found) → 503 so the
    // frontend treats it as "service unavailable" rather than a hard error.
    console.error("[/api/second-brain/profile] no candidate resolved; lastStatus", lastStatus)
    return NextResponse.json(
      {
        success: false,
        data: { message: `Second Brain profile unavailable` },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: lastStatus === 404 ? 503 : 502 }
    )
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
