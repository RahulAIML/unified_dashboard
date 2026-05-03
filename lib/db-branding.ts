import { authQuery } from "./db-auth"
import { DEFAULT_BRANDING_SETTINGS, type BrandingSettings, normalizeBrandingSettings } from "./branding"

interface BrandingRow {
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_color: string | null
}

export async function getBrandingSettings(customerId: number): Promise<BrandingSettings> {
  const rows = await authQuery<BrandingRow>(
    `SELECT logo_url, primary_color, secondary_color, accent_color
       FROM branding_settings
      WHERE customer_id = $1
      LIMIT 1`,
    [customerId]
  )

  if (rows.length === 0) {
    return DEFAULT_BRANDING_SETTINGS
  }

  return normalizeBrandingSettings(rows[0])
}

export async function upsertBrandingSettings(
  customerId: number,
  payload: BrandingSettings
): Promise<BrandingSettings> {
  const normalized = normalizeBrandingSettings(payload)
  const rows = await authQuery<BrandingRow>(
    `INSERT INTO branding_settings (customer_id, logo_url, primary_color, secondary_color, accent_color, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (customer_id)
     DO UPDATE SET
       logo_url = EXCLUDED.logo_url,
       primary_color = EXCLUDED.primary_color,
       secondary_color = EXCLUDED.secondary_color,
       accent_color = EXCLUDED.accent_color,
       updated_at = NOW()
     RETURNING logo_url, primary_color, secondary_color, accent_color`,
    [
      customerId,
      normalized.logo_url,
      normalized.primary_color,
      normalized.secondary_color,
      normalized.accent_color,
    ]
  )

  return normalizeBrandingSettings(rows[0] ?? normalized)
}
