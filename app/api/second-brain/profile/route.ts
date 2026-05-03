/**
 * /api/second-brain/profile
 *
 * Tenant-isolated server-side proxy for the Second Brain hosted API.
 * Credentials remain server-side only and are resolved per customer.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAuthContextFromRequest } from "@/lib/server-auth"
import { getTenantIntegration } from "@/lib/db-tenant-integrations"

const SECOND_BRAIN_API_URL = process.env.SECOND_BRAIN_API_URL
const SECOND_BRAIN_ADMIN_EMAIL = process.env.SECOND_BRAIN_ADMIN_EMAIL
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

  if (!SECOND_BRAIN_API_URL) {
    return NextResponse.json(
      { success: false, data: { message: "Second Brain API is not configured" }, meta: {} },
      { status: 503 }
    )
  }

  try {
    const integration = await getTenantIntegration(auth.customerId)

    // Resolution order for admin_email:
    // 1. Per-tenant config from DB (tenant_integrations table)
    // 2. Dynamic: admin@{company_domain}.com derived from user's email
    // 3. Global fallback from env var SECOND_BRAIN_ADMIN_EMAIL
    let adminEmail = integration?.second_brain_admin_email || null

    if (!adminEmail && auth.email) {
      const domain = auth.email.split("@")[1]?.toLowerCase()
      if (domain) {
        // Strip common email provider domains — only derive for company domains
        const genericDomains = new Set([
          "gmail.com", "hotmail.com", "outlook.com", "yahoo.com",
          "icloud.com", "protonmail.com", "live.com", "aol.com",
        ])
        if (!genericDomains.has(domain)) {
          // Extract company name from domain (e.g. coppel.com → coppel)
          const companyName = domain.split(".")[0]
          adminEmail = `admin@${companyName}.com`
        }
      }
    }

    if (!adminEmail) adminEmail = SECOND_BRAIN_ADMIN_EMAIL ?? null

    const apiToken = integration?.second_brain_api_token || SECOND_BRAIN_API_TOKEN

    if (!adminEmail) {
      return NextResponse.json(
        { success: false, data: { message: "Second Brain integration is not configured for this customer" }, meta: {} },
        { status: 404 }
      )
    }

    const url = new URL(`${SECOND_BRAIN_API_URL}/organizations/full-profile`)
    url.searchParams.set("admin_email", adminEmail)

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
    }

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
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
    const maskedData = maskPayload(rawData)

    return NextResponse.json({
      success: true,
      data: maskedData,
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
