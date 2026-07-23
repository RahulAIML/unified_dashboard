-- Branding customization must be per-tenant.
--
-- customer_id is resolved only from coach_app; for EVERY non-coach tenant
-- (pharma bridge, rolplay-app query-endpoint, Second Brain orgs) login/register
-- fall through to customer_id = 0. branding_settings was keyed by customer_id,
-- so all of those tenants collapsed onto a single shared row (customer_id = 0)
-- and one tenant's logo/colors leaked to every other — e.g. Coppel's logo
-- appearing for Besins.
--
-- Fix: add a stable string tenant_key and key branding by it. For coach tenants
-- the key is cust:<customer_id> (unchanged behaviour); for everyone else it is
-- domain:<email-domain>, which is distinct per company (coppel.com, besins.com,
-- takeda.com, …), so each tenant now has its OWN branding row.

ALTER TABLE branding_settings ADD COLUMN IF NOT EXISTS tenant_key TEXT;

-- Backfill existing rows so nothing is orphaned. The old shared customer_id=0
-- row becomes cust:0 (harmless legacy bucket); real coach rows keep their id.
UPDATE branding_settings SET tenant_key = 'cust:' || customer_id WHERE tenant_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS branding_settings_tenant_key_uidx ON branding_settings (tenant_key);
