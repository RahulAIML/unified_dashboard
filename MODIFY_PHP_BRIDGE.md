# How to Modify the PHP Bridge for Write Access

## ⚠️ IMPORTANT SECURITY WARNING

By enabling write access, you allow the bridge to execute:
- ✅ CREATE/ALTER/DROP TABLE (schema changes)
- ✅ INSERT/UPDATE/DELETE (data changes)
- ⚠️ Potentially **destructive operations** if credentials are compromised

**Use API key authentication carefully** and keep `BRIDGE_SECRET` private.

---

## Prerequisites

You need **ONE** of the following:

### **Option A: SSH Terminal Access** (Best)
```bash
ssh username@rolplay.pro
```

### **Option B: cPanel/Plesk File Manager**
- Login to your hosting control panel
- File Manager or File Editor

### **Option C: FTP Access**
- Connect with Filezilla or similar
- Navigate to `/src/` folder

### **Option D: phpMyAdmin**
- Direct database access
- Can skip PHP bridge modification

---

## Steps to Modify the Bridge

### **Step 1: Locate the Bridge File**

The PHP bridge is at:
```
https://rolplay.pro/src/rolplay-bridge.php
```

**On your server, it's probably in one of these locations:**
```
/home/username/public_html/src/rolplay-bridge.php
/var/www/rolplay.pro/src/rolplay-bridge.php
/srv/www/rolplay.pro/src/rolplay-bridge.php
```

---

### **Step 2: Backup the Current File**

**Via SSH:**
```bash
cd /path/to/your/src
cp rolplay-bridge.php rolplay-bridge.php.backup
echo "Backup created: rolplay-bridge.php.backup"
```

**Via File Manager:**
1. Right-click on `rolplay-bridge.php`
2. Click "Copy"
3. Rename copy to `rolplay-bridge.php.backup`

---

### **Step 3: Examine Current Bridge Code**

**Via SSH:**
```bash
cat rolplay-bridge.php
```

**Via File Manager:**
1. Right-click on `rolplay-bridge.php`
2. Click "Edit" or "View"

Look for code that says:
```php
"Only SELECT queries are permitted"
```

This is the restriction you need to remove.

---

### **Step 4: Find and Remove the Restriction**

**Look for a block like this:**

```php
// ❌ CURRENT CODE (BLOCKS WRITES)
if (stripos($sql, 'SELECT') !== 0) {
    return json_encode([
        'success' => false,
        'error' => 'Only SELECT queries are permitted'
    ]);
}
```

**Modify it to:**

```php
// ✅ NEW CODE (ALLOWS ALL)
// Removed SELECT-only restriction
// Now allows: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP
```

---

### **Step 5: Alternative - Replace Entire File**

If you prefer, I've created a complete unrestricted bridge for you:

**File:** `rolplay-bridge-unrestricted.php`

You can:
1. Download this file
2. Upload it to `/src/rolplay-bridge.php` (overwrite)
3. Update database credentials inside the file

**⚠️ Before uploading, edit these values:**

```php
define('DB_HOST', 'localhost');      // Your database host
define('DB_USER', 'your_db_user');   // Your database user
define('DB_PASSWORD', 'your_db_password');  // Your password
define('DB_NAME', 'roleplay_demorp6');      // Already correct
```

---

### **Step 6: Save the File**

**Via SSH:**
```bash
# Edit with nano
nano rolplay-bridge.php

# Make your changes, then:
# Press Ctrl+X → Y → Enter
```

**Via File Manager:**
1. Click "Save" button in the editor
2. Confirm

**Via FTP:**
1. Save locally
2. Upload to replace the file on server

---

### **Step 7: Verify the Change**

Test if write access is now enabled:

```bash
node scripts/test-db-write-access.js
```

Expected output:
```
✅ CREATE TABLE: PASS
✅ INSERT: PASS
✅ SELECT: PASS
✅ UPDATE: PASS
✅ DROP TABLE: PASS

✅ YOU HAVE WRITE ACCESS TO THE DATABASE!
```

---

## If You Don't See the Restriction Code

Your bridge might be structured differently. Here are other places to check:

### **Possibility 1: Check in a function**
```php
function executeQuery($sql, $params) {
    if (stripos($sql, 'SELECT') !== 0) {
        return error('Only SELECT queries are permitted');
    }
    // ...
}
```

### **Possibility 2: Check in a validation function**
```php
function validateSQL($sql) {
    if (!preg_match('/^SELECT/i', $sql)) {
        return false;
    }
    return true;
}
```

### **Possibility 3: Multiple restrictions**

There might be multiple checks. Search for:
- `Only SELECT`
- `SELECT queries`
- `permitted`
- `allowed`

---

## Safety Measures

After enabling write access, consider adding these safety measures:

### **Add a Whitelist of Allowed Tables**

```php
$allowed_tables = [
    'users', 'user_sessions', 'clients',
    'coach_sessions', 'simulator_scenarios',
    'lms_enrollments', 'certification_attempts',
    'second_brain_queries'
];

// Check if SQL mentions only allowed tables
foreach ($allowed_tables as $table) {
    if (preg_match("/FROM\s+$table/i", $sql) ||
        preg_match("/INTO\s+$table/i", $sql) ||
        preg_match("/UPDATE\s+$table/i", $sql)) {
        $mentions_allowed = true;
        break;
    }
}

if (!$mentions_allowed) {
    return error('Table not allowed');
}
```

### **Log All Write Operations**

```php
$operation = strtoupper(substr(trim($sql), 0, 6));
if (in_array($operation, ['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP'])) {
    error_log("[DB WRITE] $operation: $sql");
}
```

### **Add Rate Limiting**

```php
$key = $_SERVER['HTTP_X_BRIDGE_KEY'];
$cache_key = "bridge_calls_$key";
$calls = apcu_fetch($cache_key) ?? 0;

if ($calls > 100) { // 100 requests per...
    return error('Rate limit exceeded');
}

apcu_store($cache_key, $calls + 1, 60); // per 60 seconds
```

---

## Troubleshooting

### **Problem: Changes don't take effect**

**Solution:**
1. Clear browser cache (Ctrl+Shift+Delete)
2. Clear PHP opcode cache if installed
3. Restart PHP-FPM: `sudo systemctl restart php-fpm`

### **Problem: Can't find the restriction code**

**Solution:**
1. Search for "SELECT" in the file
2. Search for error messages: grep "Only SELECT" rolplay-bridge.php
3. Contact your hosting provider for the original bridge code

### **Problem: Still getting "Only SELECT queries are permitted"**

**Solution:**
1. Verify you saved the file
2. Check you modified the correct file
3. Verify the file was actually updated: `cat rolplay-bridge.php | grep "Only SELECT"`
4. If still there, the file wasn't saved properly

### **Problem: Bridge returns error after modification**

**Solution:**
1. Restore from backup: `cp rolplay-bridge.php.backup rolplay-bridge.php`
2. Make changes more carefully
3. Test with SSH editor first before uploading via FTP

---

## Next Steps

### **Once Write Access is Enabled:**

```bash
# 1. Test write access
node scripts/test-db-write-access.js

# Expected: ✅ All tests pass

# 2. Execute the migration
# Option A: Direct SQL via phpMyAdmin
# Option B: Use our execution script (if we create one)

# 3. Verify migration
node scripts/inspect-database.js

# Expected: ✅ All 8 tables exist

# 4. Update API endpoints
# Update code to use company_id filtering

# 5. Test multi-tenant
# Create 2 users in different companies
# Verify data isolation

# 6. Deploy
git push origin main
```

---

## Quick Summary

| Task | Status |
|------|--------|
| Understand restriction | ✅ Done |
| Locate bridge file | Need to check |
| Backup file | Need to do |
| Find restriction code | Need to do |
| Remove restriction | Need to do |
| Save file | Need to do |
| Test write access | Will verify |
| Execute migration | Will follow |

---

## Do You Have Server Access?

**Answer these questions:**

1. Can you SSH into `rolplay.pro`? (Y/N)
2. Do you have cPanel/Plesk access? (Y/N)
3. Can you use FTP to access files? (Y/N)
4. Do you have direct phpMyAdmin access? (Y/N)

If you answer **YES** to any of these, you can modify the bridge!

If **NO** to all, you need your hosting provider's help.

---

## I Can Help You

If you have server access, provide:

1. **SSH access** → I can guide you through exact commands
2. **File Manager access** → I can tell you exactly what to change
3. **FTP access** → I can provide the modified file

Then we can:
1. ✅ Modify the PHP bridge
2. ✅ Execute the migration
3. ✅ Update API endpoints
4. ✅ Test multi-tenant isolation
5. ✅ Deploy to production

---

**Do you have server access? 🔑**
