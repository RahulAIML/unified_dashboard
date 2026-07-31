/**
 * PUT /api/admin/tenant-branding — set a TENANT's default branding by email
 * domain, admin-only.
 *
 * This is the write side of ai-service/app/branding_lookup.py: an
 * AI-generated dashboard for a company reads branding_settings keyed by
 * `domain:<domain>` and uses it instead of the hardcoded default when
 * present. It's also the SAME key lib/db-branding.ts's per-user lookup
 * already falls back to for any signed-in user at that domain who hasn't
 * personalized their own view — so one save here serves both surfaces,
 * reusing proven, already-isolated storage rather than adding a new one.
 *
 * Distinct from PUT /api/branding, which always writes the CALLER's own
 * per-user row — this writes a named tenant's row instead, which is why it
 * requires admin and takes an explicit `domain` rather than using the
 * caller's own email.
 */
import { NextRequest } from "next/server"
import { requireAdminFromRequest } from "@/lib/server-auth"
import { buildApiError, buildSuccess } from "@/lib/api-utils"
import { getBrandingSettings, upsertBrandingSettings } from "@/lib/db-branding"
import { normalizeBrandingSettings, resolveClientBrand, validateBrandingPayload } from "@/lib/branding"

export const runtime = "nodejs"

function domainKey(raw: string): string | null {
  const domain = raw.trim().toLowerCase()
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null
  return `domain:${domain}`
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError("Admin access required", 403)

  const domain = request.nextUrl.searchParams.get("domain") ?? ""
  const key = domainKey(domain)
  if (!key) return buildApiError("A valid `domain` query param is required", 400)

  try {
    const settings = await getBrandingSettings(key)
    return buildSuccess({ settings, brand: resolveClientBrand(settings) })
  } catch (error) {
    console.error("[/api/admin/tenant-branding][GET]", error)
    return buildApiError("Failed to load tenant branding", 500)
  }
}

export async function PUT(request: NextRequest) {
  const admin = await requireAdminFromRequest(request)
  if (!admin) return buildApiError("Admin access required", 403)

  try {
    const body = await request.json()
    const key = domainKey(String(body?.domain ?? ""))
    if (!key) return buildApiError("A valid `domain` field is required", 400)

    const payload = normalizeBrandingSettings(body)
    validateBrandingPayload(payload)

    const settings = await upsertBrandingSettings(key, 0, payload)
    return buildSuccess({ settings, brand: resolveClientBrand(settings) })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save tenant branding"
    const status = message.startsWith("Invalid") || message.includes("too large") ? 400 : 500
    if (status === 500) {
      console.error("[/api/admin/tenant-branding][PUT]", error)
    }
    return buildApiError(message, status)
  }
}
