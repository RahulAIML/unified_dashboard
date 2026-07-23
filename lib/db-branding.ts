import { authQuery } from "./db-auth"
import { DEFAULT_BRANDING_SETTINGS, type BrandingSettings, normalizeBrandingSettings } from "./branding"

interface BrandingRow {
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_color: string | null
}

/**
 * Stable per-tenant branding key. customer_id collapses to 0 for every
 * non-coach tenant, so it can't isolate them; the email domain does (one per
 * company). Coach tenants keep cust:<id> so their existing row is preserved.
 */
export function brandingTenantKey(email: string, customerId: number): string {
  if (customerId > 0) return `cust:${customerId}`
  const domain = email.split("@")[1]?.toLowerCase().trim()
  return domain ? `domain:${domain}` : "cust:0"
}

export async function getBrandingSettings(tenantKey: string): Promise<BrandingSettings> {
  try {
    const rows = await authQuery<BrandingRow>(
      `SELECT logo_url, primary_color, secondary_color, accent_color
         FROM branding_settings
        WHERE tenant_key = $1
        LIMIT 1`,
      [tenantKey]
    )
    if (rows.length === 0) return DEFAULT_BRANDING_SETTINGS
    return normalizeBrandingSettings(rows[0])
  } catch (err) {
    // Fail-safe: branding is cosmetic. If the tenant_key column isn't present
    // yet (migration 004 not run) or any DB error occurs, fall back to default
    // branding rather than breaking every dashboard page that loads branding.
    console.error("[getBrandingSettings] falling back to default branding:", err)
    return DEFAULT_BRANDING_SETTINGS
  }
}

export async function upsertBrandingSettings(
  tenantKey: string,
  customerId: number,
  payload: BrandingSettings
): Promise<BrandingSettings> {
  const normalized = normalizeBrandingSettings(payload)
  const rows = await authQuery<BrandingRow>(
    `INSERT INTO branding_settings (customer_id, tenant_key, logo_url, secondary_color, primary_color, accent_color, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (tenant_key)
     DO UPDATE SET
       customer_id = EXCLUDED.customer_id,
       logo_url = EXCLUDED.logo_url,
       primary_color = EXCLUDED.primary_color,
       secondary_color = EXCLUDED.secondary_color,
       accent_color = EXCLUDED.accent_color,
       updated_at = NOW()
     RETURNING logo_url, primary_color, secondary_color, accent_color`,
    [
      customerId,
      tenantKey,
      normalized.logo_url,
      normalized.secondary_color,
      normalized.primary_color,
      normalized.accent_color,
    ]
  )

  return normalizeBrandingSettings(rows[0] ?? normalized)
}
