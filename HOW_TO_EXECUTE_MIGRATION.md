# How to Execute the Database Migration

## Test Result: ❌ READ-ONLY ACCESS

**Status:** Your PHP bridge is configured for **READ-ONLY** access  
**Error:** "Only SELECT queries are permitted"  
**Implication:** You cannot execute CREATE/ALTER/INSERT statements yourself  

---

## What This Means

```
✅ You CAN:     READ data from the database (SELECT queries)
❌ You CANNOT:  CREATE/ALTER/INSERT/UPDATE/DELETE (DDL/DML)
```

The good news: This is actually a **security feature**. Your bridge is intentionally restricted to SELECT-only to prevent accidental data loss.

The challenge: Someone with WRITE access must execute the migration.

---

## Your Options

### **Option 1: Contact Your Hosting Provider** (RECOMMENDED)

This is the most common approach.

**Email/Message them:**

```
Subject: Database Migration Request - Analytics Dashboard

Hi [Hosting Provider Support],

I need to execute a database migration on my database: roleplay_demorp6

The migration file is: migrations/001_add_multi_tenant_support.sql

This will:
- Create 3 new user management tables (users, user_sessions, clients)
- Create 5 new analytics tables (coach_sessions, simulator_scenarios, etc.)
- Add company_id columns for multi-tenant support
- Create indexes and foreign keys for data integrity

Can you please:
1. Review the attached SQL file
2. Execute it on database: roleplay_demorp6
3. Confirm all tables were created successfully

Thank you!
```

**Attach these files:**
- `migrations/001_add_multi_tenant_support.sql` (the SQL)
- `DATABASE_STATUS_REPORT.md` (explanation)

---

### **Option 2: Request Write Access to PHP Bridge**

**Ask your hosting provider to:**

Enable write operations on the PHP bridge by allowing these operations:
- CREATE TABLE
- ALTER TABLE
- INSERT
- UPDATE (for company_id updates)
- DROP TABLE (for cleanup)

**You would say:**
```
Can you enable write/DDL operations on the PHP bridge at:
https://rolplay.pro/src/rolplay-bridge.php

Currently it only allows SELECT queries.
We need it to support CREATE/ALTER/INSERT for our analytics dashboard migration.
```

If they do this, you can then run:
```bash
node scripts/execute-migration.js
```

---

### **Option 3: Direct Database Access**

**Ask your hosting provider to provide:**

- **PhpMyAdmin link** (if available)
  - Visit the URL
  - Login
  - Select database: `roleplay_demorp6`
  - Go to SQL tab
  - Paste the migration file contents
  - Click "Execute"

- **SSH/Terminal access** (if available)
  ```bash
  mysql -u username -p roleplay_demorp6 < migrations/001_add_multi_tenant_support.sql
  ```

- **cPanel/Hosting control panel**
  - Find "Database Manager" or "MySQL Tools"
  - Select `roleplay_demorp6`
  - Click "Go to phpMyAdmin"
  - Execute the SQL file

---

## What to Send to Your Hosting Provider

### Email Template

```
Subject: Database Migration for Analytics Dashboard - roleplay_demorp6

Hi [Support Team],

I need to execute a database migration to add multi-tenant support to my 
analytics dashboard. The migration creates new tables and adds necessary columns.

Database: roleplay_demorp6
Server: [your hosting provider]

MIGRATION DETAILS:
- Creates 3 user management tables: users, user_sessions, clients
- Creates 5 analytics tables: coach_sessions, simulator_scenarios, 
  lms_enrollments, certification_attempts, second_brain_queries
- Adds company_id columns for data isolation
- Adds foreign key constraints and indexes

Please execute the attached SQL file on the database and confirm success.

After you run it, I'll verify by running our test script.

Thank you!
[Your Name]
```

### Files to Attach

1. **migrations/001_add_multi_tenant_support.sql** 
   - The actual SQL migration

2. **DATABASE_STATUS_REPORT.md**
   - Explains current status
   - Lists what's missing
   - Describes the change

3. **MULTI_TENANT_IMPLEMENTATION.md** (Optional)
   - Architecture overview
   - Why these tables are needed

---

## After They Execute the Migration

### Step 1: Verify It Worked

Run the inspection script:
```bash
node scripts/inspect-database.js
```

Expected output:
```
✅ DATABASE IS READY FOR MULTI-TENANT SUPPORT
   • All required tables exist
   • All required columns exist
   • No migrations needed
```

### Step 2: Test Write Access Again

```bash
node scripts/test-db-write-access.js
```

This should now show:
```
✅ CREATE TABLE: PASS
✅ INSERT: PASS
✅ SELECT: PASS
✅ UPDATE: PASS
✅ DROP TABLE: PASS

✅ YOU HAVE WRITE ACCESS TO THE DATABASE!
```

### Step 3: Proceed with Implementation

Once verified:
1. Update existing API endpoints to use `getApiContext()`
2. Update data-provider functions with company_id filtering
3. Test multi-tenant isolation with 2+ users
4. Deploy with audit logging enabled

---

## File Locations (For Reference)

```
📄 migrations/001_add_multi_tenant_support.sql
   └─ The SQL file to execute

📄 DATABASE_STATUS_REPORT.md
   └─ Current status report

📄 MULTI_TENANT_IMPLEMENTATION.md
   └─ Architecture documentation

📊 scripts/inspect-database.js
   └─ Verification script

📊 scripts/test-db-write-access.js
   └─ Access test script
```

---

## FAQ

### Q: How long does the migration take?
**A:** Usually < 1 minute for modern databases.

### Q: Will it affect existing data?
**A:** No. The migration:
- Creates NEW tables
- Adds NEW columns to existing tables
- Doesn't delete or modify existing data

### Q: What if something goes wrong?
**A:** You can roll back by asking them to drop the new tables (minimal impact).

### Q: Do I need to update my code before the migration?
**A:** No. The database structure must exist first, THEN we update the code to use it.

### Q: How long until I can use the dashboard after migration?
**A:** 
1. Migration executes (< 1 min)
2. We verify (< 1 min)
3. Update API endpoints (1-2 hours, depending on number)
4. Test (1 hour)
5. Ready to deploy (same day or next day)

### Q: What if they say "we don't support migrations"?
**A:** They must support DDL operations to use any database. That's a red flag.
Ask specifically:
- "Can you CREATE tables?"
- "Can you run ALTER TABLE?"
- If no to both, ask to switch providers.

---

## Timeline

```
📍 NOW:        You have this message
    ↓
📧 SEND:       Email to hosting provider with migration file
    ↓
⏳ WAIT:       They execute the migration (usually 1-2 hours)
    ↓
✅ VERIFY:     Run inspect-database.js script
    ↓
📝 UPDATE:     Code to use company_id filtering
    ↓
🧪 TEST:       Multi-tenant isolation
    ↓
🚀 DEPLOY:     To production
```

---

## What I've Prepared for You

✅ **Migration file ready:** `migrations/001_add_multi_tenant_support.sql`
✅ **Documentation ready:** All explanation files created
✅ **Verification tools ready:** Scripts to confirm success
✅ **Code ready:** All multi-tenant code already written
⏳ **Waiting on:** Database write access (your hosting provider)

---

## Next Action

**Send an email to your hosting provider with:**
1. Your database name: `roleplay_demorp6`
2. The migration file: `migrations/001_add_multi_tenant_support.sql`
3. This document: `HOW_TO_EXECUTE_MIGRATION.md`
4. Request them to execute it

**Or**, if you have direct access:
1. Login to phpMyAdmin or MySQL client
2. Select database: `roleplay_demorp6`
3. Copy-paste from: `migrations/001_add_multi_tenant_support.sql`
4. Execute it
5. Run verification: `node scripts/inspect-database.js`

---

**Status:** ⏳ Awaiting database administrator to execute migration  
**Blocker:** Write access to database (your hosting provider must grant)  
**Next:** Once migration completes, update API endpoints
