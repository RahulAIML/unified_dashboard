import { authQuery } from "./db-auth"
import { DEFAULT_BRANDING_SETTINGS, type BrandingSettings, normalizeBrandingSettings } from "./branding"

interface BrandingRow {
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  accent_color: string | null
}

/**
 * Stable per-tenant (ORG-WIDE) branding key. customer_id collapses to 0 for
 * every non-coach tenant, so it can't isolate them; the email domain does (one
 * per company). Coach tenants keep cust:<id> so their existing row is preserved.
 *
 * Still used as the FALLBACK layer under per-user settings (see brandingUserKey
 * below) — a user who has never customized anything inherits whatever their
 * org already set, rather than starting from the bare default.
 */
export function brandingTenantKey(email: string, customerId: number): string {
  if (customerId > 0) return `cust:${customerId}`
  const domain = email.split("@")[1]?.toLowerCase().trim()
  return domain ? `domain:${domain}` : "cust:0"
}

/**
 * Per-USER branding key. Every user gets their own row, so one person changing
 * the platform name / colors / logo never affects anyone else signed in under
 * the same company — each user customizes their own view independently.
 *
 * This was previously the actual bug: /api/branding read and wrote ONLY
 * brandingTenantKey(...), a single row shared by every user at a company, so
 * any one person's change was visible to (and overwritten by) everyone else.
 *
 * No migration needed: tenant_key is a plain TEXT unique key, so a 'user:<id>'
 * value is just another row in the same table.
 */
export function brandingUserKey(userId: number): string {
  return `user:${userId}`
}

/**
 * Resolve settings for ONE user: their personal row if they have saved one,
 * else the org-wide default (so a first-time user isn't dropped back to plain
 * defaults if their company already has branding set), else DEFAULT.
 */
export async function getBrandingSettingsForUser(
  userId: number,
  email: string,
  customerId: number
): Promise<BrandingSettings> {
  const personal = await getBrandingSettings(brandingUserKey(userId))
  if (personal !== DEFAULT_BRANDING_SETTINGS) return personal
  return getBrandingSettings(brandingTenantKey(email, customerId))
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
