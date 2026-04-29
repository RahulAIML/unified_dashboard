/**
 * Migration: 001_add_multi_tenant_support.sql
 *
 * Adds multi-tenant support to the dashboard:
 * 1. Creates users table with company_id
 * 2. Creates user_sessions table for session management
 * 3. Creates clients table to track companies
 * 4. Adds company_id column to all analytics tables
 * 5. Adds database constraints to ensure data integrity
 *
 * EXECUTION: Run via PHP bridge or directly in MySQL
 */

-- ============================================================================
-- Step 1: Create clients table (registry of all companies)
-- ============================================================================

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(50) PRIMARY KEY COMMENT 'Unique company identifier (e.g., "coppel", "acme")',
  name VARCHAR(255) NOT NULL COMMENT 'Display name (e.g., "Coppel")',
  domain VARCHAR(255) UNIQUE COMMENT 'Primary email domain (e.g., "coppel.com")',
  status ENUM('active', 'inactive', 'trial') DEFAULT 'active' COMMENT 'Company status',
  settings JSON COMMENT 'Company-specific settings (colors, logos, etc.)',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_domain (domain),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Step 2: Create users table with company_id
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL COMMENT 'User email',
  password_hash VARCHAR(255) NOT NULL COMMENT 'Bcrypt password hash',
  full_name VARCHAR(255) COMMENT 'User full name',
  company_domain VARCHAR(255) COMMENT 'Email domain used for registration (e.g., "coppel.com")',
  company_id VARCHAR(50) NOT NULL COMMENT 'Company ID from clients table',
  role ENUM('user', 'admin') DEFAULT 'user',
  last_login TIMESTAMP NULL COMMENT 'Last successful login',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_company_id (company_id),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id)
    REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT check_company_not_null CHECK (company_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Step 3: Create user_sessions table for token invalidation
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL COMMENT 'User ID',
  token_jti VARCHAR(255) UNIQUE NOT NULL COMMENT 'JWT ID for token invalidation',
  expires_at TIMESTAMP NOT NULL COMMENT 'Token expiration time',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_expires (expires_at),
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Step 4: Add company_id to analytics tables (CRITICAL for data isolation)
-- ============================================================================

-- Coach sessions table
ALTER TABLE coach_sessions
ADD COLUMN company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay' AFTER user_id,
ADD INDEX idx_company_sessions (company_id, id),
ADD CONSTRAINT fk_coach_company FOREIGN KEY (company_id)
  REFERENCES clients(id) ON DELETE RESTRICT;

-- Simulator scenarios table
ALTER TABLE simulator_scenarios
ADD COLUMN company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay' AFTER user_id,
ADD INDEX idx_company_scenarios (company_id, id),
ADD CONSTRAINT fk_simulator_company FOREIGN KEY (company_id)
  REFERENCES clients(id) ON DELETE RESTRICT;

-- LMS enrollments table
ALTER TABLE lms_enrollments
ADD COLUMN company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay' AFTER user_id,
ADD INDEX idx_company_enrollments (company_id, id),
ADD CONSTRAINT fk_lms_company FOREIGN KEY (company_id)
  REFERENCES clients(id) ON DELETE RESTRICT;

-- Certification attempts table
ALTER TABLE certification_attempts
ADD COLUMN company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay' AFTER user_id,
ADD INDEX idx_company_cert (company_id, id),
ADD CONSTRAINT fk_cert_company FOREIGN KEY (company_id)
  REFERENCES clients(id) ON DELETE RESTRICT;

-- Second brain queries table
ALTER TABLE second_brain_queries
ADD COLUMN company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay' AFTER user_id,
ADD INDEX idx_company_kb (company_id, id),
ADD CONSTRAINT fk_kb_company FOREIGN KEY (company_id)
  REFERENCES clients(id) ON DELETE RESTRICT;

-- ============================================================================
-- Step 5: Backfill existing data with default company_id
-- ============================================================================

-- For development: Assign all existing data to 'rolplay' company
-- In production, you'll need to migrate per-company data based on your mapping

UPDATE coach_sessions SET company_id = 'rolplay' WHERE company_id = '';
UPDATE simulator_scenarios SET company_id = 'rolplay' WHERE company_id = '';
UPDATE lms_enrollments SET company_id = 'rolplay' WHERE company_id = '';
UPDATE certification_attempts SET company_id = 'rolplay' WHERE company_id = '';
UPDATE second_brain_queries SET company_id = 'rolplay' WHERE company_id = '';

-- ============================================================================
-- Step 6: Insert default companies
-- ============================================================================

INSERT INTO clients (id, name, domain, status) VALUES
  ('rolplay', 'Rolplay Internal', 'rolplay.pro', 'active'),
  ('rolplay-com', 'Rolplay', 'rolplay.com', 'active'),
  ('coppel', 'Coppel', 'coppel.com', 'active'),
  ('coppel-mx', 'Coppel Mexico', 'coppel.com.mx', 'active')
ON DUPLICATE KEY UPDATE status='active';

-- ============================================================================
-- Verification queries (run after migration)
-- ============================================================================

-- Check table structure
-- DESCRIBE users;
-- DESCRIBE user_sessions;
-- DESCRIBE clients;

-- Check indexes exist
-- SHOW INDEX FROM users;
-- SHOW INDEX FROM coach_sessions;

-- Check constraints
-- SELECT CONSTRAINT_NAME, TABLE_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
-- WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'fk_%';

-- Check company_id values backfilled correctly
-- SELECT company_id, COUNT(*) FROM coach_sessions GROUP BY company_id;
-- SELECT company_id, COUNT(*) FROM simulator_scenarios GROUP BY company_id;
