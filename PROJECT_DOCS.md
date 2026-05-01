# RolPlay Analytics Dashboard — Complete Project Documentation

> Last updated: 2026-05-01  
> Production URL: https://rolplaypro-dashboard.onrender.com  
> Repository: https://github.com/RahulAIML/unified_dashboard

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Database Structure](#3-database-structure)
4. [Authentication System](#4-authentication-system)
5. [PHP Bridge Contract](#5-php-bridge-contract)
6. [Customer IDs & Emails](#6-customer-ids--emails)
7. [Environment Variables](#7-environment-variables)
8. [API Endpoints](#8-api-endpoints)
9. [Solution Module Mapping](#9-solution-module-mapping)
10. [Deployment (Render)](#10-deployment-render)
11. [Complete Test Flow](#11-complete-test-flow)
12. [Known Issues & Fixes Applied](#12-known-issues--fixes-applied)
13. [File Structure](#13-file-structure)
14. [Adding New Customers](#14-adding-new-customers)

---

## 1. Project Overview

RolPlay Analytics Dashboard is a **multi-tenant SaaS analytics platform** for coaching, LMS, simulator, certification, and second-brain solutions.

### What it does
- Displays KPI metrics (sessions, scores, pass rates) per customer
- Shows trend charts, evaluation results, per-module breakdowns
- Full session drilldown with Q&A fields, scores, AI assessment
- JWT-based authentication with company auto-detection from email domain
- CSV export for all data views
- AI assistant (Claude-powered)
- Bilingual UI (Spanish / English toggle)

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React, Tailwind CSS, Recharts, Framer Motion |
| Backend | Next.js API Routes (server-side) |
| Auth DB | PostgreSQL (Render managed) |
| Analytics DB | MySQL (via PHP Bridge — read-only) |
| Deployment | Render (Node, free plan) |
| Bridge | PHP at `https://rolplayadmin.com/coach-app/src/rolplay-bridge.php` |

---

## 2. Architecture

```
Browser
  │
  ├── GET /auth/login  ──→  Login Page (Next.js)
  ├── GET /           ──→  Dashboard (protected by middleware)
  │
  └── API calls (with httpOnly JWT cookies)
        │
        ├── /api/auth/*          ──→  PostgreSQL (Render Auth DB)
        │                              users + user_sessions tables
        │
        └── /api/dashboard/*     ──→  PHP Bridge
                                        ──→ MySQL (rolplay_pro_analytics)
                                        ──→ MySQL (coach_app)
```

### Key Design Decisions

- **Two separate databases**: PostgreSQL for auth (users/sessions), MySQL for analytics (read-only via bridge)
- **PHP Bridge is read-only production dependency** — NEVER modify the bridge PHP file
- **Multi-tenant isolation**: All queries filter by `customer_id` extracted from the JWT
- **httpOnly cookies**: Both `accessToken` (8h) and `refreshToken` (7d) are httpOnly, SameSite=lax
- **No direct MySQL access**: Port 3306 is not open externally; all analytics queries go through the bridge

---

## 3. Database Structure

### Database A — PostgreSQL (Auth) — `rolplay_auth_db`

Managed by Render. Connection via `AUTH_DATABASE_URL` env var.

```sql
-- Users table
CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(255),
  customer_id     INTEGER DEFAULT 0,
  role            VARCHAR(50) DEFAULT 'user',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- Sessions table
CREATE TABLE user_sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_jti   VARCHAR(255) UNIQUE NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Branding settings (per customer)
CREATE TABLE branding_settings (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER UNIQUE NOT NULL,
  primary_color   VARCHAR(7),
  secondary_color VARCHAR(7),
  accent_color    VARCHAR(7),
  logo_url        TEXT,
  updated_at      TIMESTAMP DEFAULT NOW()
);
```

### Database B — MySQL (Analytics) — `rolplay_pro_analytics`

Read-only via PHP Bridge. Never write to this DB.

**Key tables:**

```
rolplay_pro_analytics.report_field_current
  - saved_report_id   INT        → unique session ID
  - customer_id       INT        → tenant filter (always WHERE customer_id = ?)
  - usecase_id        INT        → which use case/module
  - field_key         VARCHAR    → e.g. 'overall_score', 'question_1', 'answer_1'
  - value_num         DECIMAL    → numeric value (score 0-10 or 0-100)
  - value_text        TEXT       → short text value
  - value_longtext    LONGTEXT   → long text (assessments, recommendations)
  - report_created_at DATETIME   → when the session was recorded

coach_app.saved_reports
  - id                INT        → = saved_report_id above
  - passed_flag       TINYINT    → 1 = passed, 0 = failed

coach_app.coach_users
  - user_email        VARCHAR    → email (used to resolve customer_id at login)
  - customer_id       INT        → maps email → tenant

coach_app.usecases
  - id                INT
  - usecase_name      VARCHAR
  - customer_id       INT
  - tool_type         TINYINT
```

**Score normalization:** `overall_score` values ≤ 10 are on a 0–10 scale → multiply by 10 to get 0–100.

### Database C — MySQL (Coach App) — `coach_app`

Also read-only via bridge. Contains user/usecase metadata.

---

## 4. Authentication System

### Flow

```
1. User submits email + password on /auth/login
2. API validates password against PostgreSQL (bcrypt)
3. API calls resolveCustomerIdByEmail(email) → bridge query to coach_app.coach_users
4. customer_id embedded in JWT payload
5. accessToken (8h) + refreshToken (7d) set as httpOnly cookies
6. All dashboard API calls forward cookies automatically (credentials: 'include')
7. API routes extract customer_id from JWT → use for all DB queries
```

### JWT Payload

```json
{
  "user_id": 5,
  "email": "eleazar.palacios@takeda.com",
  "customer_id": 11,
  "iat": 1777604667,
  "exp": 1777633467,
  "jti": "access-5-1777604667166-abc"
}
```

### Key Files

| File | Purpose |
|------|---------|
| `lib/jwt.ts` | Sign / verify JWT tokens |
| `lib/password.ts` | bcrypt hash + compare |
| `lib/db-auth.ts` | PostgreSQL pool connection |
| `lib/db-users.ts` | User CRUD queries |
| `lib/server-auth.ts` | Extract auth context from request |
| `middleware.ts` | Redirect unauthenticated page requests to /auth/login |
| `components/AuthProvider.tsx` | Client-side auth state context |

### Endpoints

```
POST /api/auth/register   → create user, issue tokens
POST /api/auth/login      → validate password, issue tokens
GET  /api/auth/me         → return current user from JWT
POST /api/auth/refresh    → exchange refreshToken for new accessToken
POST /api/auth/logout     → clear cookies
GET  /api/auth/setup      → create DB tables (one-time, protected by SETUP_SECRET)
```

---

## 5. PHP Bridge Contract

> ⚠️ The bridge PHP file is a READ-ONLY production dependency. NEVER modify it.

**URL:** `https://rolplayadmin.com/coach-app/src/rolplay-bridge.php`

### Request Format

```http
POST /coach-app/src/rolplay-bridge.php
Content-Type: application/json
X-Bridge-Key: <BRIDGE_SECRET>

{
  "sql": "SELECT * FROM table WHERE id = ?",
  "params": [123]
}
```

### Response Format

```json
{
  "success": true,
  "data": [ { "col": "value" }, ... ],
  "error": null
}
```

### Rules

- Only `POST` with `{ sql, params }` is supported
- No GET `?action=...` calls — those return "Unknown action"
- `X-Bridge-Key` header must match `BRIDGE_SECRET` env var
- Returns empty array `[]` (not null) when query returns no rows
- All params use `?` placeholders (MySQL prepared statements)
- DB user `rpsim@%` has `SELECT, SHOW VIEW` on `*.*` — read-only

---

## 6. Customer IDs & Emails

### All Customer IDs

| Customer ID | Company | Users | Has Analytics Data |
|-------------|---------|-------|--------------------|
| **4** | Test/Demo | 7 | ❌ No sessions |
| **11** | Takeda | 80 | ✅ 1 session (report #518) |
| **12** | RolPlay / Profuturo | 4 | ❌ No sessions |
| **14** | Internal | 1 | ❌ No sessions |
| **15** | Internal | 1 | ❌ No sessions |
| **0** | System/Test | — | ⚠️ 25 sessions, but blocked by auth |

> `customer_id=0` is blocked — `resolveCustomerIdByEmail` returns `null` for any value ≤ 0.

---

### Customer 4 — Demo/Test

```
two@two.com
three@three.com
four@four.com
five@five.com
seven@seven.com
ten@ten.com
eleven@eleven.com
```
*No analytics data yet — login works, dashboard shows empty.*

---

### Customer 11 — Takeda (HAS DATA ✅)

80 users. Best ones to test with:

```
eleazar.palacios@takeda.com       ← most tested, report #518 exists
gustavo.ochoa@takeda.com
rogelio.lazaro@takeda.com
monica.hernandez@takeda.com
alfredo.solis@takeda.com
ana.barajas@takeda.com
arturo.reyes@takeda.com
carlos.rodriguez@takeda.com
luis.flores@takeda.com
juan.tapia@takeda.com
```

*Note: All 80 users share the same customer_id=11, so they all see the same dashboard data.*

---

### Customer 12 — RolPlay / Profuturo

```
cesar.conchello@rolplay.ca
diego.merigo@rolplay.ca
mario.zenteno@audioweb.com.mx
mario.zenteno@profuturo.mx
```
*No analytics data yet.*

---

### Customer 14

```
emilio.zenteno@icloud.com
```

### Customer 15

```
alezentenor@outlook.com
```

---

## 7. Environment Variables

### Required in Render Dashboard (set manually — `sync: false`)

| Variable | Value | Purpose |
|----------|-------|---------|
| `AUTH_DATABASE_URL` | `postgresql://rolplay_auth_db_user:REDACTED_PASSWORD@REDACTED_HOST/rolplay_auth_db?sslmode=require` | PostgreSQL auth DB |
| `BRIDGE_SECRET` | `REDACTED_BRIDGE_SECRET` | PHP bridge API key |
| `JWT_SECRET` | `REDACTED_JWT_SECRET` | Sign access tokens |
| `REFRESH_SECRET` | `REDACTED_REFRESH_SECRET` | Sign refresh tokens |
| `SETUP_SECRET` | `REDACTED_SETUP_SECRET` | Protect /api/auth/setup |

### Already set in `render.yml` (no action needed)

| Variable | Value |
|----------|-------|
| `BRIDGE_URL` | `https://rolplayadmin.com/coach-app/src/rolplay-bridge.php` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` |

### Local Development (`.env.local`)

```env
BRIDGE_URL=https://rolplayadmin.com/coach-app/src/rolplay-bridge.php
BRIDGE_SECRET=REDACTED_BRIDGE_SECRET
AUTH_DATABASE_URL=postgresql://rolplay_auth_db_user:REDACTED_PASSWORD@REDACTED_HOST/rolplay_auth_db?sslmode=require
JWT_SECRET=REDACTED_JWT_SECRET
REFRESH_SECRET=REDACTED_REFRESH_SECRET
SETUP_SECRET=REDACTED_SETUP_SECRET
USE_REAL_DB=true
```

---

## 8. API Endpoints

### Auth Endpoints (public)

```
POST /api/auth/register
  Body: { full_name, email, password }
  Response: { success, data: { user: { id, email, full_name, customer_id, role } } }

POST /api/auth/login
  Body: { email, password }
  Response: { success, data: { user } }
  Sets: accessToken + refreshToken cookies (httpOnly)

GET  /api/auth/me
  Auth: accessToken cookie
  Response: { success, data: { user } }

POST /api/auth/refresh
  Auth: refreshToken cookie
  Response: { success } + new accessToken cookie

POST /api/auth/logout
  Clears both cookies

GET  /api/auth/setup?secret=<SETUP_SECRET>
  Creates all PostgreSQL tables (run once after deployment)
```

### Dashboard Endpoints (authenticated)

All require `accessToken` cookie. All accept `from`, `to` (ISO dates), optional `solution` and `usecaseIds`.

```
GET /api/dashboard/overview
  ?from=2026-04-01T00:00:00Z&to=2026-05-01T23:59:59Z&solution=coach
  Response: { totalEvaluations, avgScore, passRate, passedEvaluations, prev* }

GET /api/dashboard/trends
  Response: { scoreTrend, passFailTrend, evalCountTrend }
  Each trend: [{ date, value }]

GET /api/dashboard/results
  ?limit=20
  Response: { data: [{ savedReportId, usecaseId, score, result, passed, date }] }

GET /api/dashboard/usecase-breakdown
  Response: { data: [{ usecaseId, usecase_name, totalEvaluations, avgScore, passRate, passed }] }

GET /api/dashboard/drilldown/:savedReportId
  Response: { savedReportId, usecaseId, date, fields: [...], closingJson: {...} }

GET /api/health
  Response: bridge connectivity + config status (no auth required)
```

### Solution Filter Values

Pass `?solution=<value>` to filter by module:

```
solution=lms
solution=coach
solution=simulator
solution=certification
solution=second-brain
```

---

## 9. Solution Module Mapping

File: `lib/solution-map.ts`

Maps dashboard module names → usecase IDs in `coach_app.usecases`:

| Solution | Usecase IDs | Usecase Names |
|----------|-------------|---------------|
| `coach` | 7, 9, 10, 12, 14, 17, 18, 19, 23, 24, 31, 33, 42 | HyQvia Coaching, Coach HyQvia, Coach Takeda Livtencity, Coach Takeda SNC, Coach Livtencity, Takeda Coach Exkruthera, Takeda Coach, Takeda Coach Adcetris, Coach Chinoin, Coach Reforzamiento HyQvia, Coach Entyvio, + pending |
| `lms` | 20 | Profuturo Afore |
| `simulator` | 21, 30 | Profuturo Afore Simulador, Prueba Simulador |
| `certification` | 22 | Profuturo Afore Evaluador |
| `second-brain` | 26, 27, 28, 29 | Coach Second Brain Exkruthera/HyQvia/Adcetris/Livtencity |

> When new usecases are added to the DB, add their IDs to this map.

---

## 10. Deployment (Render)

### Service Config (`render.yml`)

```yaml
type: web
name: rolplaypro-dashboard
runtime: node
buildCommand: npm install --include=dev && npm run build
startCommand: npm start
healthCheckPath: /
```

### Deploy Process

1. Push to `main` branch on GitHub
2. Render auto-detects the push and rebuilds
3. Build takes ~3-5 minutes
4. Zero-downtime deploy

### First-Time Setup on a New Render Service

1. Connect GitHub repo in Render dashboard
2. Add all 5 environment variables (see section 7)
3. Deploy
4. Once live, run setup endpoint:
   ```
   GET https://your-url.onrender.com/api/auth/setup?secret=REDACTED_SETUP_SECRET
   ```
5. Check health:
   ```
   GET https://your-url.onrender.com/api/health
   ```

### Free Plan Limitations

- Service **spins down after 15 min of inactivity** — first request after idle takes ~30s
- 750 free hours/month
- Upgrade to "Starter" ($7/mo) to keep it always-on

---

## 11. Complete Test Flow

### Prerequisites

1. Env vars set in Render (section 7)
2. DB setup run once: `https://rolplaypro-dashboard.onrender.com/api/auth/setup?secret=REDACTED_SETUP_SECRET`

---

### Test 1: Register + Login (customer with data)

**URL:** `https://rolplaypro-dashboard.onrender.com/auth/register`

| Field | Value |
|-------|-------|
| Full Name | `Eleazar Palacios` |
| Email | `eleazar.palacios@takeda.com` |
| Password | `Test@12345` |
| Confirm Password | `Test@12345` |

**Expected:** Redirects to `/` dashboard showing:
- Practice Sessions: **1**
- Avg Score: **80**
- Pass Rate: **0%**

---

### Test 2: Navigate Modules

| Page | URL | Expected |
|------|-----|----------|
| Overview | `/` | 1 session, score 80 |
| Master Coach | `/coach` | 1 session, score 80 |
| LMS | `/lms` | "No data available" |
| Simulator | `/simulator` | "No data available" |
| Certification | `/certification` | "No data available" |
| Second Brain | `/second-brain` | "No data available" |
| Settings | `/settings` | Logo + color pickers |

---

### Test 3: Drilldown

1. On Overview page, click the row in **Evaluation Results** table
2. OR navigate directly to `/drilldown/518`

**Expected:** Full session detail showing:
- Report #518, Score 80 pts (raw: 8), Date: 2026-04-29
- 3 pages of fields: overall_score, breakdown, assessment, strengths, weaknesses, recommendations, Q&A 1–10
- All text in Spanish
- Export CSV button works

---

### Test 4: Sign Out

Click **Sign out** in sidebar → redirects to `/auth/login` ✅

---

### Test 5: Login (returning user)

**URL:** `https://rolplaypro-dashboard.onrender.com/auth/login`

| Field | Value |
|-------|-------|
| Email | `eleazar.palacios@takeda.com` |
| Password | `Test@12345` |

**Expected:** Redirects to dashboard ✅

---

### Test 6: Empty Dashboard (customer without data)

Register with `two@two.com` (customer 4) — all modules show "No data available" — correct behavior.

---

## 12. Known Issues & Fixes Applied

### Fix 1: Bridge client used GET `?action=...` (not supported)
**Problem:** Old `bridge-client.ts` used `GET ?action=overview_kpis` etc. Live bridge only supports `POST { sql, params }`.  
**Fix:** Rewrote entire `lib/bridge-client.ts` to use raw SQL POST queries.  
**Commit:** `dad9a12`

---

### Fix 2: `credentials: 'include'` missing from dashboard fetches
**Problem:** `lib/hooks/useApi.ts` called `fetch(url, { signal })` without forwarding cookies, causing 401 on all dashboard data requests after login.  
**Fix:** Added `credentials: 'include'` to every fetch call.  
**Commit:** `ea0f4e0`

---

### Fix 3: MySQL `ONLY_FULL_GROUP_BY` error in drilldown
**Problem:** `SELECT MIN(report_created_at), usecase_id` without GROUP BY violates MySQL 8 strict mode.  
**Fix:** Changed to `SELECT report_created_at, usecase_id ... ORDER BY id ASC LIMIT 1`.  
**Commit:** `0ecbaef`

---

### Fix 4: Solution map had wrong usecase IDs
**Problem:** `lib/solution-map.ts` had IDs 323–401 from a different database state. Production DB max usecase ID is 31.  
**Fix:** Rebuilt map with correct IDs 7–42 verified from `coach_app.usecases`.  
**Commit:** `0ecbaef`

---

### Fix 5: PostgreSQL SSL self-signed certificate error
**Problem:** `?sslmode=require` in `AUTH_DATABASE_URL` caused newer `pg` versions to ignore `rejectUnauthorized: false` and fail with "self-signed certificate".  
**Fix:** Strip `sslmode` param from URL before creating the Pool; handle SSL entirely through the config object.  
**Commit:** `cdff89f`

---

### Fix 6: Wrong `BRIDGE_URL` in `render.yml`
**Problem:** `render.yml` had an old bridge URL (`improveyourpitchbeta.net`) — all production bridge calls failed.  
**Fix:** Updated to `https://rolplayadmin.com/coach-app/src/rolplay-bridge.php`.  
**Commit:** `0ecbaef`

---

### Fix 7: Input text invisible on login/register
**Problem:** Input fields lacked `bg-white` and `text-slate-900` — typed text was invisible in some browsers.  
**Fix:** Added `bg-white text-slate-900 placeholder:text-slate-400` to all auth form inputs.  
**Commit:** `0ecbaef`

---

## 13. File Structure

```
dashboard/
├── app/
│   ├── page.tsx                    # Overview dashboard (/)
│   ├── coach/page.tsx              # Master Coach module
│   ├── lms/page.tsx                # LMS module
│   ├── simulator/page.tsx          # Simulator module
│   ├── certification/page.tsx      # Certification module
│   ├── second-brain/page.tsx       # Second Brain module
│   ├── drilldown/[id]/page.tsx     # Session drilldown
│   ├── settings/page.tsx           # Branding settings
│   ├── auth/
│   │   ├── login/page.tsx          # Login page
│   │   └── register/page.tsx       # Register page
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts
│       │   ├── register/route.ts
│       │   ├── me/route.ts
│       │   ├── refresh/route.ts
│       │   ├── logout/route.ts
│       │   └── setup/route.ts      # DB table creation
│       ├── dashboard/
│       │   ├── overview/route.ts
│       │   ├── trends/route.ts
│       │   ├── results/route.ts
│       │   ├── usecase-breakdown/route.ts
│       │   └── drilldown/[savedReportId]/route.ts
│       ├── branding/route.ts
│       └── health/route.ts
│
├── lib/
│   ├── bridge-client.ts            # All MySQL queries via PHP bridge (POST sql/params)
│   ├── solution-map.ts             # solution name → usecase IDs mapping
│   ├── data-provider.ts            # Bridge → normalized dashboard data
│   ├── api-utils.ts                # Shared API helpers (parseDateRange, parseUsecaseFilter)
│   ├── db-auth.ts                  # PostgreSQL pool connection
│   ├── db-users.ts                 # User CRUD (PostgreSQL)
│   ├── db-branding.ts              # Branding CRUD (PostgreSQL)
│   ├── jwt.ts                      # JWT sign/verify
│   ├── password.ts                 # bcrypt hash/compare
│   ├── server-auth.ts              # Extract auth context from request
│   ├── kpi-builder.ts              # KPI calculations from raw data
│   ├── translations.ts             # ES/EN translation strings
│   ├── hooks/
│   │   ├── useApi.ts               # Authenticated fetch hook (credentials: include)
│   │   └── useTranslation.ts       # Language toggle hook
│   └── ...
│
├── components/
│   ├── AuthProvider.tsx            # Client-side auth state context
│   ├── DashboardHeader.tsx         # Top header with filters
│   ├── Sidebar.tsx                 # Navigation sidebar
│   ├── SummaryCard.tsx             # KPI metric card
│   └── charts/                     # Recharts wrappers
│
├── middleware.ts                   # Route protection (redirects to /auth/login)
├── render.yml                      # Render deployment config
├── .env.local                      # Local dev environment (not in git)
└── PROJECT_DOCS.md                 # This file
```

---

## 14. Adding New Customers

When a new company onboards:

### Step 1: Add users to `coach_app.coach_users`
```sql
-- Done by the RolPlay admin panel, not by the dashboard
INSERT INTO coach_app.coach_users (user_email, customer_id) VALUES ('user@company.com', <new_id>);
```

### Step 2: Update `lib/solution-map.ts`
Add any new usecase IDs to the correct solution bucket:
```typescript
export const SOLUTION_USECASE_MAP: Record<SolutionKey, number[]> = {
  coach: [7, 9, 10, ..., <new_usecase_id>],
  // ...
}
```

### Step 3: User registers on the dashboard
The user goes to `/auth/register`, enters their email.  
The system automatically:
- Looks up their `customer_id` from `coach_app.coach_users`
- Embeds it in the JWT
- All data queries are filtered to their company

### Step 4: Data starts flowing
As users run coaching sessions in the RolPlay app, data appears in `report_field_current` — the dashboard picks it up immediately (no cache).

---

## Quick Reference: Common Tasks

### Check bridge is working
```
GET https://rolplaypro-dashboard.onrender.com/api/health
```

### Re-initialize auth tables (if DB is reset)
```
GET https://rolplaypro-dashboard.onrender.com/api/auth/setup?secret=REDACTED_SETUP_SECRET
```

### Test login via curl
```bash
curl -X POST https://rolplaypro-dashboard.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"eleazar.palacios@takeda.com","password":"Test@12345"}'
```

### Run locally
```bash
cd dashboard
npm run dev
# Visit http://localhost:3000
```

### Deploy
```bash
git add .
git commit -m "your message"
git push origin main
# Render auto-deploys in ~3-5 minutes
```

---

*Documentation generated from the full development session — 2026-05-01*
