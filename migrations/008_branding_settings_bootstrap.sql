-- branding_settings has never had a numbered migration that actually creates
-- it — only 004 ALTERs it, assuming it already exists via a manual call to
-- GET /api/auth/setup. On any deployment where that endpoint was never hit
-- (confirmed live in production, 2026-07-31), every branding PUT 500s with
-- "Auth database schema not initialised", and the color/logo customization
-- silently appears to do nothing.
--
-- This migration is safe to run whether the table is missing entirely,
-- exists in its original (pre-004) form, or already has tenant_key from a
-- prior manual /api/auth/setup call.

CREATE TABLE IF NOT EXISTS branding_settings (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL DEFAULT 0,
  tenant_key      TEXT,
  logo_url        TEXT,
  primary_color   TEXT NOT NULL DEFAULT '#DC2626',
  secondary_color TEXT NOT NULL DEFAULT '#1F2937',
  accent_color    TEXT NOT NULL DEFAULT '#14B8A6',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The table's original definition (app/api/auth/setup/route.ts, before this
-- migration) had `customer_id INTEGER UNIQUE NOT NULL`. customer_id is 0 for
-- every non-coach tenant, so that constraint allowed AT MOST ONE branding row
-- total across every pharma/rolplay-app/second-brain tenant AND every
-- per-user personalization row (lib/db-branding.ts's brandingUserKey/
-- brandingTenantKey both write customer_id=0 for these) — the second person
-- or tenant to ever save branding would 500 on a duplicate-key violation.
-- tenant_key (added below) is the real uniqueness boundary now; drop the
-- stale constraint so it can't silently block multi-tenant saves again.
ALTER TABLE branding_settings DROP CONSTRAINT IF EXISTS branding_settings_customer_id_key;

ALTER TABLE branding_settings ADD COLUMN IF NOT EXISTS tenant_key TEXT;
UPDATE branding_settings SET tenant_key = 'cust:' || customer_id WHERE tenant_key IS NULL;
ALTER TABLE branding_settings ALTER COLUMN tenant_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS branding_settings_tenant_key_uidx ON branding_settings (tenant_key);
CREATE INDEX IF NOT EXISTS idx_branding_customer_id ON branding_settings (customer_id);
