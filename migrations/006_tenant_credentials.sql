-- 006_tenant_credentials.sql
--
-- Per-tenant credentials, encrypted at rest, writable at RUNTIME.
--
-- This is the table that makes self-service onboarding possible. Until now a
-- tenant's LMS credentials had to exist as environment variables named after
-- the tenant key (LMS_<KEY>_API_URL, …), which meant every new customer needed
-- an env change and a redeploy — i.e. developer intervention, the exact thing
-- the platform is supposed to remove. It was also the direct cause of Apotex's
-- LMS tab staying hidden: the DB-assigned tenant key did not match the env var
-- name, so the credentials were never read. See docs/ARCHITECTURE_AUDIT.md (A1).
--
-- Values are AES-256-GCM ciphertext produced by lib/secret-crypto.ts. The master
-- key lives in Render's environment (one secret, set once); only per-tenant
-- ciphertext lives here. A database dump therefore leaks nothing usable.
--
-- ADDITIVE: creates a new table only. No existing table, column, or row is
-- touched, and nothing reads from here until a tenant row exists — the resolver
-- falls back to the existing env vars, so every current tenant keeps working
-- unchanged. Rollback is at the bottom.

CREATE TABLE IF NOT EXISTS tenant_credentials (
  id             BIGSERIAL    PRIMARY KEY,

  -- Matches pharma_tenants.tenant_key, but intentionally NOT a foreign key:
  -- credentials also apply to non-pharma tenants (rolplay-app, banco), which
  -- have no row in that table. A FK here would make this table unusable for
  -- exactly the tenants the builder onboards.
  tenant_key     TEXT         NOT NULL,

  -- Which integration these belong to: 'lms' | 'bridge' | 'second_brain' | …
  -- Free text rather than an enum so a new connector needs no migration.
  provider       TEXT         NOT NULL,

  -- Credential field name, e.g. 'api_url' | 'client_id' | 'client_secret' |
  -- 'access_token'. Mirrors the env var suffixes so migration is mechanical.
  field          TEXT         NOT NULL,

  -- AES-256-GCM envelope: 'v1:<iv>:<tag>:<ciphertext>'. NEVER plaintext.
  -- Non-secret values (api_url) are encrypted too: uniform handling means no
  -- code path can accidentally treat a secret as public.
  value_encrypted TEXT        NOT NULL,

  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- One live value per (tenant, provider, field). Upsert target for the wizard.
  CONSTRAINT tenant_credentials_unique UNIQUE (tenant_key, provider, field)
);

-- The only lookup the request path performs: everything for one tenant+provider.
CREATE INDEX IF NOT EXISTS tenant_credentials_lookup
  ON tenant_credentials (tenant_key, provider)
  WHERE is_active;

COMMENT ON TABLE tenant_credentials IS
  'Encrypted per-tenant integration credentials. Written at runtime by onboarding; '
  'removes the redeploy-per-tenant requirement. Ciphertext only — see lib/secret-crypto.ts.';

COMMENT ON COLUMN tenant_credentials.value_encrypted IS
  'AES-256-GCM envelope from lib/secret-crypto.ts. Never store plaintext here.';

-- ROLLBACK
--   DROP INDEX IF EXISTS tenant_credentials_lookup;
--   DROP TABLE IF EXISTS tenant_credentials;
-- Safe at any time: the resolver falls back to environment variables, so
-- dropping this table returns the system to its previous behaviour exactly.
-- Do NOT drop it after migrating a tenant OFF env vars without restoring those
-- vars first, or that tenant loses its integration.
