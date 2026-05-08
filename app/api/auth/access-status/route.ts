/**
 * /api/auth/access-status
 *
 * Server-side access check — resolves which data sources the authenticated
 * user can reach. Must run server-side so that SECOND_BRAIN_API_URL /
 * SECOND_BRAIN_API_TOKEN (non-NEXT_PUBLIC_ env vars) are available.
 *
 * Do NOT call getAccessStatus() from client components — it imports
 * second-brain-api.ts which uses server env vars that are undefined in the
 * browser. Use this endpoint via useApi() instead.
 */

import { NextRequest, NextResponse } from "next/server"
import { getAuthContextFromRequest } from "@/lib/server-auth"
import { getTenantIntegration } from "@/lib/db-tenant-integrations"
import { isBancoOrg } from "@/lib/org-type"

export const dynamic = "force-dynamic"

const SECOND_BRAIN_API_URL   = process.env.SECOND_BRAIN_API_URL
const SECOND_BRAIN_ADMIN_EMAIL = process.env.SECOND_BRAIN_ADMIN_EMAIL
const SECOND_BRAIN_API_TOKEN   = process.env.SECOND_BRAIN_API_TOKEN

// ── Email → admin-email resolution (mirrors /api/second-brain/profile) ────────

const EXPLICIT_EMAIL_MAP: Record<string, string> = {
  "admin@salinas.com": "admin@salinas.com",
}

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "outlook.com", "yahoo.com",
  "icloud.com", "protonmail.com", "live.com", "aol.com",
])

function resolveAdminEmail(
  userEmail: string,
  tenantOverride: string | null | undefined,
  envFallback: string | null | undefined,
): string | null {
  if (tenantOverride) return tenantOverride

  const lower = userEmail.toLowerCase()
  if (lower in EXPLICIT_EMAIL_MAP) return EXPLICIT_EMAIL_MAP[lower]

  const domain = lower.split("@")[1] ?? ""
  if (domain && !GENERIC_DOMAINS.has(domain)) {
    // Preserve the full domain so international TLDs (.com.mx, .co.uk, etc.)
    // are not stripped — admin@audioweb.com.mx, not admin@audioweb.com
    return `admin@${domain}`
  }

  return envFallback ?? null
}

// ── Second Brain reachability probe ──────────────────────────────────────────

async function probeSecondBrainAccess(
  customerId: number,
  userEmail: string,
): Promise<boolean> {
  if (!SECOND_BRAIN_API_URL) return false

  try {
    const integration = await getTenantIntegration(customerId).catch(() => null)
    const adminEmail  = resolveAdminEmail(
      userEmail,
      integration?.second_brain_admin_email,
      SECOND_BRAIN_ADMIN_EMAIL,
    )
    if (!adminEmail) return false

    const apiToken = integration?.second_brain_api_token || SECOND_BRAIN_API_TOKEN

    const url = new URL(`${SECOND_BRAIN_API_URL}/organizations/full-profile`)
    url.searchParams.set("admin_email", adminEmail)

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      // Short timeout — this is just an access probe, not a full data fetch
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    })

    return res.ok
  } catch {
    return false
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await getAuthContextFromRequest(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, data: { message: "Unauthorized" }, meta: {} },
      { status: 401 },
    )
  }

  const hasCoachData       = auth.customerId > 0
  const hasSecondBrainData = await probeSecondBrainAccess(auth.customerId, auth.email)
  const hasBancoAccess     = isBancoOrg(auth.email)
  const hasAnyAccess       = hasCoachData || hasSecondBrainData || hasBancoAccess

  return NextResponse.json({
    success: true,
    data: { hasCoachData, hasSecondBrainData, hasBancoAccess, hasAnyAccess },
    meta: { timestamp: new Date().toISOString() },
  })
}
