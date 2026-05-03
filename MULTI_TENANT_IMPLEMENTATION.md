# Multi-Tenant Architecture Implementation Guide

## Overview

This document describes the production-grade multi-tenant architecture implemented in the RolPlay Analytics Dashboard. Data isolation is enforced at **three security layers**: middleware, API context, and database queries.

## Architecture Diagram

```
User Login
  ↓
JWT Token Generated with company_id (from users.company_id)
  ↓
Middleware validates JWT → Extracts company_id → Sets headers (x-user-company-id)
  ↓
API Endpoint → getApiContext() → Validates company_id header
  ↓
Database Query → WHERE company_id = '{validated_company_id}'
  ↓
PHP Bridge → Verifies company_id again → Executes filtered query
```

## Security Layers

### Layer 1: JWT Token & Middleware

**File:** `middleware.ts`

- Extracts JWT from httpOnly cookie or Authorization header
- Verifies JWT signature and expiration
- Validates company_id is present and valid format
- Sets headers for downstream handlers:
  - `x-user-id`: User ID from JWT
  - `x-user-company`: Company ID (original, unsanitized)
  - `x-user-company-id`: Company ID (sanitized, safe for queries)
- Logs all access attempts (security audit trail)

```typescript
// Middleware validates and sanitizes company_id
const sanitized = sanitizeCompanyId(payload.company_id)
if (!sanitized) {
  logSecurityEvent('access_denied', { reason: 'invalid_company_id_format' })
  // Redirect to login
}
response.headers.set('x-user-company-id', sanitized)
```

### Layer 2: API Context Extraction

**File:** `lib/api-helpers.ts`

Every API route handler must extract and validate company_id:

```typescript
export async function GET(request: NextRequest) {
  const context = getApiContext(request)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // Now safe to use context.companyId in queries
  // context = { userId: 123, companyId: 'coppel', email: 'user@coppel.com' }
}
```

**What happens if company_id is missing:**
- getApiContext() returns null
- Endpoint returns 401 Unauthorized
- Request is logged for audit

### Layer 3: Secure Bridge Wrapper

**File:** `lib/bridge-secure.ts`

All database operations go through secure bridge functions that:

1. **Never accept client-submitted company_id**
   - company_id always comes from validated JWT
   - User cannot override it via request body

2. **Force company_id into every query**
   - SELECT: `WHERE company_id = '{companyId}'`
   - INSERT: Auto-inject `company_id` into data
   - UPDATE/DELETE: Add to WHERE clause

3. **Verify PHP bridge responses**
   - Check returned rows have matching company_id
   - Log mismatches as security incidents

**Example: Secure Insert**

```typescript
// User cannot inject company_id
const body = { user_id: 123, score: 85 } // No company_id here
const result = await secureInsert(context.companyId, 'coach_sessions', body)

// Result: INSERT INTO coach_sessions (..., company_id) VALUES (..., 'coppel')
// company_id = 'coppel' is FORCED, not from user input
```

## Implementation Files

### New Files Created

```
lib/
  ├── multi-tenant.ts              # Core validation helpers
  │   ├── extractCompanyIdFromToken()
  │   ├── validateClientAccess()
  │   ├── sanitizeCompanyId()
  │   ├── buildCompanyFilter()
  │   └── logSecurityEvent()
  │
  ├── bridge-secure.ts             # Secure PHP bridge wrapper
  │   ├── secureBridgeCall()
  │   ├── secureSelect()
  │   ├── secureInsert()
  │   ├── secureUpdate()
  │   ├── secureDelete()
  │   └── secureQuery()
  │
  └── api-helpers.ts               # API context extraction
      ├── getApiContext()
      ├── validateRequestBody()
      ├── getSafeQueryParams()
      └── withAuditHeaders()

app/api/
  ├── kpis/coach/route.ts          # Example: Secure read endpoint
  └── coach-sessions/route.ts      # Example: Secure write endpoint

migrations/
  └── 001_add_multi_tenant_support.sql  # Database schema changes
```

### Modified Files

```
middleware.ts
  - Added company_id extraction and validation
  - Added sanitizeCompanyId check
  - Added logSecurityEvent calls
  - Sets x-user-company-id header

lib/auth.ts
  - Already includes company_id in TokenPayload ✓
  - Already generates JWT with company_id ✓

lib/db-users.ts
  - Already includes company_id in User type ✓
  - Already includes company_id in createUser() ✓
```

## Database Schema

### New Tables

**clients** — Registry of all companies

```sql
CREATE TABLE clients (
  id VARCHAR(50) PRIMARY KEY,              -- 'coppel', 'acme', etc.
  name VARCHAR(255) NOT NULL,              -- 'Coppel', 'Acme Corp'
  domain VARCHAR(255) UNIQUE,              -- 'coppel.com'
  status ENUM('active', 'inactive'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**users** — Users with company_id

```sql
CREATE TABLE users (
  id INT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  company_domain VARCHAR(255),             -- Email domain at registration
  company_id VARCHAR(50) NOT NULL,         -- Links to clients.id
  role ENUM('user', 'admin'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  INDEX idx_company_id (company_id),
  FOREIGN KEY (company_id) REFERENCES clients(id)
);
```

**user_sessions** — Session management

```sql
CREATE TABLE user_sessions (
  id INT PRIMARY KEY,
  user_id INT NOT NULL,
  token_jti VARCHAR(255) UNIQUE,           -- JWT ID for invalidation
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Modified Tables

All analytics tables get a `company_id` column:

```sql
ALTER TABLE coach_sessions
ADD COLUMN company_id VARCHAR(50) NOT NULL DEFAULT 'rolplay',
ADD INDEX idx_company_sessions (company_id, id),
ADD FOREIGN KEY (company_id) REFERENCES clients(id);

-- Same for: simulator_scenarios, lms_enrollments, 
--           certification_attempts, second_brain_queries
```

## Integration Checklist

### 1. Database Setup

```bash
# Run migration via PHP bridge or MySQL client
mysql -u root -p < migrations/001_add_multi_tenant_support.sql

# Verify tables created
SHOW TABLES;  -- Should see: clients, users, user_sessions

# Check indexes
SHOW INDEX FROM users;
SHOW INDEX FROM coach_sessions;
```

### 2. Update Existing API Endpoints

**OLD PATTERN:**
```typescript
export async function GET(request: NextRequest) {
  const clientId = parseClientId(sp)  // From query param
  const data = await getDashboardOverview({ clientId })
}
```

**NEW PATTERN:**
```typescript
export async function GET(request: NextRequest) {
  const context = getApiContext(request)  // From JWT in headers
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  
  const data = await getDashboardOverview({ company_id: context.companyId })
}
```

### 3. Update Data Provider Functions

**File:** `lib/data-provider.ts`

Add company_id filtering to all queries:

```typescript
export async function getDashboardOverview(params: {
  from: Date
  to: Date
  company_id: string  // NEW
}) {
  const query = `
    SELECT ... FROM coach_sessions
    WHERE 
      company_id = '${params.company_id}'  -- ADD THIS
      AND date >= ... AND date <= ...
  `
  
  // Use secureQuery instead of direct query
  return await secureQuery(params.company_id, query)
}
```

### 4. Test Multi-Tenant Isolation

**Test Case 1: Same Company Access**

```bash
# User A (coppel.com) logs in → Gets company_id = 'coppel'
# User B (coppel.com) logs in → Gets company_id = 'coppel'
# Both access same data ✓
```

**Test Case 2: Cross-Company Denial**

```bash
# User A (coppel.com) tries to access acme.com data
# JWT contains company_id = 'coppel'
# Query filters: WHERE company_id = 'coppel'
# Returns empty for acme.com data ✓
# Access denied at multiple layers
```

**Test Case 3: Token Tampering**

```bash
# Attacker modifies JWT: company_id = 'acme'
# Middleware validates JWT signature → Fails ✓
# Request rejected before reaching API
```

## Usage Patterns

### Pattern 1: Reading Company-Specific Data

```typescript
// In API route handler
const context = getApiContext(request)

// Option A: Using secureSelect helper
const sessions = await secureSelect<CoachSession>(
  context.companyId,
  'coach_sessions',
  { user_id: 123 }
)

// Option B: Using secureQuery for complex queries
const query = `
  SELECT AVG(score) FROM coach_sessions
  WHERE company_id = '${context.companyId}'
  AND date >= '2026-01-01'
`
const result = await secureQuery(context.companyId, query)
```

### Pattern 2: Writing Company-Specific Data

```typescript
// In API route handler
const context = getApiContext(request)
const body = await request.json()

// Validate only allowed fields
const cleanBody = validateRequestBody(body, ['user_id', 'score', 'result'])

// secureInsert AUTOMATICALLY injects company_id
const result = await secureInsert(
  context.companyId,
  'coach_sessions',
  cleanBody
)
// Result: INSERT with company_id = context.companyId (forced)
```

### Pattern 3: New Client Onboarding

When user registers with email@newclient.com:

```typescript
// 1. Email domain detected: newclient.com
// 2. Company ID generated: 'newclient'
// 3. Create in clients table:
INSERT INTO clients (id, name, domain) VALUES ('newclient', 'New Client', 'newclient.com')

// 4. User created with company_id:
INSERT INTO users (email, company_id, ...) VALUES ('alice@newclient.com', 'newclient', ...)

// 5. JWT generated with company_id = 'newclient'
// 6. All data queries automatically filtered: WHERE company_id = 'newclient'
// 7. ZERO CODE CHANGES NEEDED
```

## Security Verification

### Checklist

- [ ] Middleware validates company_id format (sanitizeCompanyId)
- [ ] All API endpoints call getApiContext() first
- [ ] All database queries include WHERE company_id = '...'
- [ ] secureInsert/Update/Delete used for writes (not raw queries)
- [ ] Request bodies validated (no company_id field injection)
- [ ] Query parameters sanitized (no company_id override)
- [ ] Audit logging enabled for access attempts
- [ ] Foreign keys set up (company_id → clients.id)
- [ ] Database indexes created (idx_company_*)
- [ ] Cross-company tests passing

### Security Tests

**Test: Unauthorized user cannot access other company data**

```bash
curl -H "Authorization: Bearer <coppel_jwt>" \
  https://api.rolplay.com/api/coach-sessions?company_id=acme

# Expected: 401 Unauthorized or empty data filtered by company_id
# Actual: Middleware validates JWT contains company_id=coppel, 
#         API filters query WHERE company_id = 'coppel',
#         No acme data returned
```

**Test: User cannot modify JWT company_id**

```bash
# Attacker modifies JWT: company_id = 'acme'
# Sends tampered token

# Result: JWT signature verification fails in middleware
# Request rejected before reaching API
```

**Test: User cannot inject company_id in request body**

```bash
curl -X POST https://api.rolplay.com/api/coach-sessions \
  -H "Authorization: Bearer <coppel_jwt>" \
  -d '{"user_id": 123, "score": 85, "company_id": "acme"}'

# Expected: company_id from body is ignored
# Actual: validateRequestBody() filters allowed fields,
#         secureInsert() forces company_id = 'coppel',
#         Data inserted with correct company_id
```

## Remaining Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| JWT Token Hijacking | HIGH | httpOnly cookies + short expiration (15m) |
| Query Injection | HIGH | Use parameterized queries in PHP bridge |
| Missing company_id filter in query | HIGH | Code review + automated checks |
| Cross-tenant data leak | CRITICAL | Multiple validation layers (middleware + API + DB) |
| Unencrypted company_id in logs | LOW | Logs are internal only, company_id not sensitive |
| SQL injection via company_id | HIGH | sanitizeCompanyId() + parameterized queries |

## Next Steps

1. **Run database migration:** `001_add_multi_tenant_support.sql`
2. **Update existing API endpoints** to use getApiContext() + secureSelect/Insert/Update
3. **Update data-provider.ts** to filter queries by company_id
4. **Test multi-tenant isolation** with at least 2 companies
5. **Enable audit logging** in production
6. **Monitor logs** for security events (access_denied, validation_failed)

## Files to Review

- `lib/multi-tenant.ts` — Core security functions
- `lib/bridge-secure.ts` — Secure database wrapper
- `middleware.ts` — JWT validation + company_id extraction
- `app/api/kpis/coach/route.ts` — Example read endpoint
- `app/api/coach-sessions/route.ts` — Example write endpoint
- `migrations/001_add_multi_tenant_support.sql` — Database schema

## Support

For questions about multi-tenant implementation:
1. Review `lib/multi-tenant.ts` for validation functions
2. Check `app/api/*/route.ts` examples for patterns
3. Verify database schema in `migrations/001_add_multi_tenant_support.sql`
4. Check security audit logs via `logSecurityEvent()` calls
