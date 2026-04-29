-- ============================================================================
-- RolPlay Analytics — Auth PostgreSQL Schema
-- Migration: 002_auth_postgresql_schema.sql
--
-- Target:  Separate PostgreSQL auth database (AUTH_DATABASE_URL)
-- Purpose: User accounts + session management
--
-- This schema is SEPARATE from the analytics MySQL database.
-- Analytics data (report_field_current, report_payload_current, etc.)
-- stays in the MySQL database accessed via the PHP bridge.
--
-- Run via: GET /api/auth/setup?secret=REDACTED_SETUP_SECRET
--   OR manually in psql / Neon SQL editor / Supabase SQL editor.
-- ============================================================================

-- ── Users table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,

  -- Authentication
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,

  -- Profile
  full_name       VARCHAR(255) NOT NULL DEFAULT '',

  -- Multi-tenancy
  -- company_domain: raw domain portion of the email (e.g. "coppel.com")
  -- company_id:     normalised client ID (e.g. "coppel") derived from domain mapping
  --                 Used to scope all analytics queries for this user.
  company_domain  VARCHAR(255) NOT NULL DEFAULT '',
  company_id      VARCHAR(100) NOT NULL DEFAULT 'custom',

  -- Access control
  role            VARCHAR(20)  NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,

  -- Metadata
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email      ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users (role);

-- ── User sessions table ────────────────────────────────────────────────────────

-- Tracks refresh tokens so we can invalidate them on logout.
-- Access tokens are stateless (JWT expiry only).
CREATE TABLE IF NOT EXISTS user_sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_jti   VARCHAR(255) UNIQUE NOT NULL,   -- JWT ID from the refresh token
  expires_at  TIMESTAMPTZ  NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_jti     ON user_sessions (token_jti);

-- ── Future: client_map table (optional, for dynamic domain mapping) ────────────
-- For now company detection is handled in lib/company-mapping.ts.
-- When you onboard a new client, add their domain there.
-- If you want DB-driven domain mapping later, create this table:
--
-- CREATE TABLE IF NOT EXISTS client_map (
--   id           SERIAL PRIMARY KEY,
--   email_domain VARCHAR(255) UNIQUE NOT NULL,
--   client_id    VARCHAR(100) NOT NULL,
--   created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
-- );
-- INSERT INTO client_map (email_domain, client_id) VALUES
--   ('coppel.com',    'coppel'),
--   ('coppel.com.mx', 'coppel'),
--   ('rolplay.pro',   'rolplay'),
--   ('rolplay.ai',    'rolplay');

-- ── Cleanup helper ─────────────────────────────────────────────────────────────
-- Optional: call periodically to remove expired sessions
-- DELETE FROM user_sessions WHERE expires_at < NOW();
