-- Login routing for query-endpoint (rolplay.app) clients.
--
-- The AI builder's publish step only registered PHARMA clients (it upserted
-- pharma_tenants + pharma_tenant_domains). For a query-endpoint client such as
-- Siigo it stored the dashboard config and reported success, but never wrote any
-- login → client_id mapping — so the client's users hit "You're not linked to any
-- organization". Domain→client_id lived only in code/env, which is not
-- self-service.
--
-- This table makes it DB-backed so publishing a new query-endpoint client makes
-- its logins resolve immediately, with no deploy.

CREATE TABLE IF NOT EXISTS rolplay_app_domains (
  domain      TEXT PRIMARY KEY,          -- email domain, lowercase (e.g. siigo.com)
  client_id   INTEGER NOT NULL,          -- r_client.ID on the rolplay.app platform
  display_name TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rolplay_app_domains_client_idx ON rolplay_app_domains (client_id);

-- Seed the mappings verified from r_user (same set currently hardcoded in
-- lib/bridge-rolplay-app.ts, which stays as a fallback). audioweb.com.mx is
-- deliberately excluded: it is a shared staff domain spanning several clients.
INSERT INTO rolplay_app_domains (domain, client_id, display_name) VALUES
  ('siigo.com',              29, 'Siigo'),
  ('takeda.com',             13, 'Takeda'),
  ('besins-healthcare.com',  14, 'Besins'),
  ('rowe.com.do',            25, 'Rowe'),
  ('rowe.com',               25, 'Rowe')
ON CONFLICT (domain) DO NOTHING;
