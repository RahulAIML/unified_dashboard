import { NextRequest } from "next/server"
import { getAuthContextFromRequest } from "@/lib/server-auth"
import { buildApiError, buildSuccess } from "@/lib/api-utils"
import { getBrandingSettingsForUser, upsertBrandingSettings, brandingUserKey } from "@/lib/db-branding"
import { normalizeBrandingSettings, resolveClientBrand, validateBrandingPayload } from "@/lib/branding"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const auth = await getAuthContextFromRequest(request)
  if (!auth) return buildApiError("Unauthorized", 401)

  try {
    // Per-user, with an org-wide fallback for anyone who hasn't personalized
    // yet. See lib/db-branding.ts — this used to be ONE row shared by every
    // user at a company, so one person's change overwrote everyone else's.
    const settings = await getBrandingSettingsForUser(auth.userId, auth.email, auth.customerId)
    return buildSuccess({
      settings,
      brand: resolveClientBrand(settings),
    })
  } catch (error) {
    console.error("[/api/branding][GET]", error)
    return buildApiError("Failed to load branding", 500)
  }
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthContextFromRequest(request)
  if (!auth) return buildApiError("Unauthorized", 401)

  try {
    const body = await request.json()
    const payload = normalizeBrandingSettings(body)
    validateBrandingPayload(payload)

    // Written to the PERSONAL row only — never the shared org-wide row — so
    // saving never affects any other signed-in user.
    const settings = await upsertBrandingSettings(brandingUserKey(auth.userId), auth.customerId, payload)
    return buildSuccess({
      settings,
      brand: resolveClientBrand(settings),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save branding"
    const status = message.startsWith("Invalid") || message.includes("too large") ? 400 : 500
    if (status === 500) {
      console.error("[/api/branding][PUT]", error)
    }
    return buildApiError(message, status)
  }
}
