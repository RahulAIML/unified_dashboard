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
import { secondBrainAdminCandidates } from "@/lib/banco-second-brain"
import { isBancoOrg } from "@/lib/org-type"
import { resolveRolplayAppClientId } from "@/lib/bridge-rolplay-app"
import { resolvePharmaTenant } from "@/lib/pharma-tenant"
import { isDemoMode } from "@/lib/demo"
import { demoAccessStatus } from "@/lib/demo/engine"

export const dynamic = "force-dynamic"

const SECOND_BRAIN_API_URL   = process.env.SECOND_BRAIN_API_URL
const SECOND_BRAIN_API_TOKEN = process.env.SECOND_BRAIN_API_TOKEN

// ── Second Brain reachability probe ──────────────────────────────────────────

// The Second Brain full-profile endpoint routinely takes 10–15s (free-tier
// hosting + heavy aggregate query), so the probe needs a generous timeout.
// Results are cached in-memory so only the first dashboard load pays the cost.
const PROBE_TIMEOUT_MS      = 20_000
const PROBE_OK_TTL_MS       = 10 * 60_000 // positive result: 10 min
const PROBE_FAIL_TTL_MS     = 60_000      // negative result: 1 min (cold starts recover)

const probeCache = new Map<string, { ok: boolean; at: number }>()

/**
 * True iff the user's OWN Second Brain org resolves upstream. Uses the exact
 * same candidate resolution as /api/second-brain/profile
 * (secondBrainAdminCandidates: DB override → admin1@{domain}, NO shared env
 * fallback) so the probe and the page can never disagree. The previous version
 * used a different derivation (admin@{domain}) plus a global env fallback to a
 * shared admin email — that made the probe report "you have Second Brain" for
 * everyone (via another tenant's org), while the page correctly showed "not set
 * up", i.e. the module appeared but was empty. Aligning them also removes that
 * cross-tenant fallback from this path entirely.
 */
async function probeSecondBrainAccess(
  customerId: number,
  userEmail: string,
): Promise<boolean> {
  if (!SECOND_BRAIN_API_URL) return false

  const cacheKey = userEmail.toLowerCase().trim()
  const cached = probeCache.get(cacheKey)
  if (cached) {
    const ttl = cached.ok ? PROBE_OK_TTL_MS : PROBE_FAIL_TTL_MS
    if (Date.now() - cached.at < ttl) return cached.ok
  }

  try {
    const integration = await getTenantIntegration(customerId).catch(() => null)
    const apiToken = integration?.second_brain_api_token || SECOND_BRAIN_API_TOKEN
    const candidates = await secondBrainAdminCandidates(userEmail, customerId)

    for (const adminEmail of candidates) {
      const url = new URL(`${SECOND_BRAIN_API_URL}/organizations/full-profile`)
      url.searchParams.set("admin_email", adminEmail)
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: "no-store",
      }).catch(() => null)
      if (res && res.ok) {
        probeCache.set(cacheKey, { ok: true, at: Date.now() })
        return true
      }
    }

    probeCache.set(cacheKey, { ok: false, at: Date.now() })
    return false
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

  // ── DEMO MODE ──────────────────────────────────────────────────────────────
  if (isDemoMode()) {
    return NextResponse.json({
      success: true,
      data: demoAccessStatus(),
      meta: { timestamp: new Date().toISOString(), source: 'demo' },
    })
  }

  const hasCoachData       = auth.customerId > 0
  const hasSecondBrainData = await probeSecondBrainAccess(auth.customerId, auth.email)
  const hasBancoAccess     = isBancoOrg(auth.email)
  const hasPharmaAccess    = await resolvePharmaTenant(auth.email) !== null
  // rolplay-app (query-endpoint) clients resolve by login/domain → client_id.
  // Without this flag the client gates them out and shows "not linked".
  const hasRolplayAppAccess = resolveRolplayAppClientId(auth.email) !== null
  const hasAnyAccess       = hasCoachData || hasSecondBrainData || hasBancoAccess || hasPharmaAccess || hasRolplayAppAccess

  return NextResponse.json({
    success: true,
    data: { hasCoachData, hasSecondBrainData, hasBancoAccess, hasPharmaAccess, hasRolplayAppAccess, hasAnyAccess },
    meta: { timestamp: new Date().toISOString() },
  })
}
