# Database Status Report

**Date:** 2026-04-29  
**Database:** roleplay_demorp6  
**Connection:** PHP Bridge (https://rolplay.pro/src/rolplay-bridge.php)  

---

## Current Status: ⚠️ DATABASE NEEDS SETUP

### Tables Found: 2 (Unknown tables)
- Database contains only 2 unidentified tables
- All analytics tables are **missing**
- All user management tables are **missing**

### What's Missing:

```
User Management Tables (CRITICAL):
  ❌ users              — User accounts with authentication
  ❌ user_sessions      — Session/token management
  ❌ clients            — Company/organization registry

Analytics Tables (REQUIRED):
  ❌ coach_sessions          — Coach module data
  ❌ simulator_scenarios     — Simulator module data
  ❌ lms_enrollments         — LMS module data
  ❌ certification_attempts  — Certification module data
  ❌ second_brain_queries    — Knowledge base queries
```

---

## What You Need to Do

### Option 1: Simple (Recommended) — Run SQL Migration

The database migration file I created has everything needed:

**File:** `migrations/001_add_multi_tenant_support.sql`

This file will:
1. ✅ Create `clients` table (company registry)
2. ✅ Create `users` table (with company_id)
3. ✅ Create `user_sessions` table (for logout/invalidation)
4. ✅ Create missing analytics tables (if they don't exist)
5. ✅ Add `company_id` column to existing analytics tables
6. ✅ Create foreign keys for data integrity
7. ✅ Create indexes for performance

**How to execute via PHP Bridge:**

You have **2 options**:

#### **Option A: Direct SQL Upload (Simplest)**

If the PHP bridge supports file upload or raw SQL:
```bash
# Contact your database administrator and ask them to:
# 1. Run the SQL file: migrations/001_add_multi_tenant_support.sql
# 2. Confirm all tables were created successfully
```

#### **Option B: Split Into Statements**

If the bridge prefers statement-by-statement:

```sql
-- Create clients table
CREATE TABLE clients (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) UNIQUE,
  status ENUM('active', 'inactive', 'trial') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_domain (domain),
  INDEX idx_status (status)
);

-- Create users table
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  company_domain VARCHAR(255),
  company_id VARCHAR(50) NOT NULL,
  role ENUM('user', 'admin') DEFAULT 'user',
  last_login TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_company_id (company_id),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id)
    REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT check_company_not_null CHECK (company_id IS NOT NULL)
);

-- Create user_sessions table
CREATE TABLE user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_jti VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_expires (expires_at),
  INDEX idx_user_id (user_id)
);

-- Create coach_sessions table
CREATE TABLE coach_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay',
  score DECIMAL(5, 2),
  result VARCHAR(50),
  date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_sessions (company_id, id),
  CONSTRAINT fk_coach_company FOREIGN KEY (company_id)
    REFERENCES clients(id) ON DELETE RESTRICT
);

-- Create simulator_scenarios table
CREATE TABLE simulator_scenarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay',
  scenario_name VARCHAR(255),
  score DECIMAL(5, 2),
  date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_scenarios (company_id, id),
  CONSTRAINT fk_simulator_company FOREIGN KEY (company_id)
    REFERENCES clients(id) ON DELETE RESTRICT
);

-- Create lms_enrollments table
CREATE TABLE lms_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay',
  course_id INT,
  status VARCHAR(50),
  completion_percent DECIMAL(5, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_enrollments (company_id, id),
  CONSTRAINT fk_lms_company FOREIGN KEY (company_id)
    REFERENCES clients(id) ON DELETE RESTRICT
);

-- Create certification_attempts table
CREATE TABLE certification_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay',
  exam_type VARCHAR(100),
  score DECIMAL(5, 2),
  result VARCHAR(50),
  date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_cert (company_id, id),
  CONSTRAINT fk_cert_company FOREIGN KEY (company_id)
    REFERENCES clients(id) ON DELETE RESTRICT
);

-- Create second_brain_queries table
CREATE TABLE second_brain_queries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay',
  query_text TEXT,
  response TEXT,
  relevance_score DECIMAL(3, 2),
  date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_company_kb (company_id, id),
  CONSTRAINT fk_kb_company FOREIGN KEY (company_id)
    REFERENCES clients(id) ON DELETE RESTRICT
);

-- Insert default companies
INSERT INTO clients (id, name, domain, status) VALUES
  ('rolplay', 'Rolplay Internal', 'rolplay.pro', 'active'),
  ('rolplay-com', 'Rolplay', 'rolplay.com', 'active'),
  ('coppel', 'Coppel', 'coppel.com', 'active'),
  ('coppel-mx', 'Coppel Mexico', 'coppel.com.mx', 'active')
ON DUPLICATE KEY UPDATE status='active';
```

---

## Write Access Requirements

To execute the migration, you'll need:

### **Database Permissions Needed:**

```sql
-- Create tables
CREATE TABLE
ALTER TABLE
DROP TABLE (for cleanup if needed)

-- Create/modify indexes
CREATE INDEX
ALTER INDEX

-- Create foreign keys
ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY

-- Insert default data
INSERT INTO clients ...

-- Modify existing analytics tables
ALTER TABLE coach_sessions ADD COLUMN company_id ...
ALTER TABLE simulator_scenarios ADD COLUMN company_id ...
ALTER TABLE lms_enrollments ADD COLUMN company_id ...
ALTER TABLE certification_attempts ADD COLUMN company_id ...
ALTER TABLE second_brain_queries ADD COLUMN company_id ...
```

### **Who has write access:**

Check with your database administrator:
- Do you have access to execute DDL statements (CREATE/ALTER TABLE)?
- Can you modify the roleplay_demorp6 database?
- Does the PHP bridge accept write operations?

### **If you DON'T have direct access:**

1. **Ask your database administrator** to:
   - Review the SQL migration file: `migrations/001_add_multi_tenant_support.sql`
   - Execute it on the roleplay_demorp6 database
   - Confirm all tables were created successfully

2. **Or contact your hosting provider** if using managed database service

---

## Verification Steps

After the migration is complete:

### **Step 1: Verify tables were created**

```bash
# Run the inspection script again
node scripts/inspect-database.js

# Expected output:
# ✅ DATABASE IS READY FOR MULTI-TENANT SUPPORT
# • All required tables exist
# • All required columns exist
```

### **Step 2: Verify table structure**

```sql
-- Check users table
DESCRIBE users;

-- Should show columns:
-- id, email, password_hash, full_name, company_id, company_domain, role, created_at, updated_at

-- Check coach_sessions table
DESCRIBE coach_sessions;

-- Should show columns:
-- id, user_id, company_id, score, result, date, created_at
```

### **Step 3: Verify foreign keys**

```sql
-- Check constraints
SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = 'roleplay_demorp6'
AND CONSTRAINT_NAME LIKE 'fk_%';

-- Should show:
-- fk_users_company
-- fk_coach_company
-- fk_simulator_company
-- fk_lms_company
-- fk_cert_company
-- fk_kb_company
```

### **Step 4: Verify indexes**

```sql
-- Check indexes
SHOW INDEX FROM users;
SHOW INDEX FROM coach_sessions;

-- Should show:
-- idx_company_id (on users)
-- idx_company_sessions (on coach_sessions)
-- etc.
```

---

## Timeline

```
📍 Current: Database discovered (empty analytics, no user tables)
    ↓
❌ BLOCKER: Need to create tables via migration
    ↓
✅ READY: After migration executes
    ↓
🚀 NEXT: Run inspection script to verify
    ↓
📝 NEXT: Update API endpoints to use company_id filtering
    ↓
✅ DONE: Test multi-tenant isolation
```

---

## What Comes After Database Setup

Once the migration is complete:

1. **Update API endpoints** to use `getApiContext()` and `secureSelect/Insert/Update`
2. **Update data-provider functions** to filter by `company_id`
3. **Test multi-tenant isolation** with 2+ test users
4. **Deploy and monitor** audit logs for security events

---

## FAQ

### Q: Who creates these tables?
**A:** Someone with write access to the database. This is usually:
- Your database administrator
- Your hosting provider
- You (if you have admin access)

### Q: Do I need all these tables immediately?
**A:** Yes. The `users` and `user_sessions` tables are critical for authentication to work. The analytics tables are critical for the dashboard to function.

### Q: Can I just run it myself?
**A:** Only if you have write access to the database. Check with your admin if you're unsure.

### Q: What if the PHP bridge doesn't support DDL?
**A:** Ask your hosting provider to:
1. Give you SSH/terminal access to run MySQL directly, OR
2. Run the SQL file for you, OR
3. Update the bridge to support CREATE/ALTER statements

### Q: Can I test without these tables?
**A:** No. The authentication system requires the `users` table, and the dashboard requires the analytics tables.

---

## Files Reference

**Migration file:** `migrations/001_add_multi_tenant_support.sql`  
**Verification script:** `scripts/inspect-database.js`  
**Multi-tenant docs:** `MULTI_TENANT_IMPLEMENTATION.md`  

---

**Status:** ⏳ Awaiting database migration execution  
**Next Action:** Execute migration or contact database administrator
