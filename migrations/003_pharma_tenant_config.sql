-- ============================================================================
-- RolPlay Analytics — Self-Service Pharma Tenant Config
-- Migration: 003_pharma_tenant_config.sql
--
-- Target:  Separate PostgreSQL auth database (AUTH_DATABASE_URL)
-- Purpose: Let an admin register a new pharma-sim client (endpoint, module
--          survey, exercise IDs, login domains) without a developer editing
--          lib/pharma-tenant.ts and redeploying. Rows here are merged over
--          the hardcoded defaults at runtime — see lib/pharma-tenant.ts.
--
-- Run via: GET /api/auth/setup?secret=REDACTED_SETUP_SECRET
--   OR manually in psql / Neon SQL editor / Supabase SQL editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS pharma_tenants (
  id                  SERIAL PRIMARY KEY,
  tenant_key          VARCHAR(100) UNIQUE NOT NULL,
  display_name        VARCHAR(255) NOT NULL,

  -- Which of the 3 known bridge shapes this client's endpoint speaks.
  kind                VARCHAR(20)  NOT NULL
                        CHECK (kind IN ('sale_exercises', 'kpi', 'exceltis_rest')),
  url                 TEXT         NOT NULL,
  x_tenant            VARCHAR(100),

  -- Exercise/usecase ID allowlist (required for sale_exercises/exceltis_rest).
  ucids               JSONB        NOT NULL DEFAULT '[]',

  -- Module survey — what does this client actually have real data for.
  has_certification   BOOLEAN      NOT NULL DEFAULT FALSE,
  has_objections      BOOLEAN      NOT NULL DEFAULT FALSE,
  has_business_lines  BOOLEAN      NOT NULL DEFAULT FALSE,
  has_organization     BOOLEAN      NOT NULL DEFAULT FALSE,
  has_top_stats       BOOLEAN      NOT NULL DEFAULT FALSE,
  coach_activity_ids  JSONB, -- 'kpi' kind only — activity_ids that are the real Coach module

  -- Auth for reaching this tenant's server (may be on a different host).
  auth_header_name    VARCHAR(100),
  auth_header_value   TEXT,

  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharma_tenants_key ON pharma_tenants (tenant_key);

-- Email domain → tenant_key, so a manager can add "acme.com" and users at
-- that domain immediately resolve into the new tenant on next login.
CREATE TABLE IF NOT EXISTS pharma_tenant_domains (
  id          SERIAL PRIMARY KEY,
  domain      VARCHAR(255) UNIQUE NOT NULL,
  tenant_key  VARCHAR(100) NOT NULL REFERENCES pharma_tenants(tenant_key) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharma_tenant_domains_domain ON pharma_tenant_domains (domain);
