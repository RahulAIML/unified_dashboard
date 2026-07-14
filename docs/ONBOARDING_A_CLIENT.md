# Onboarding a New Client (End-to-End)

This guide explains **how a client becomes visible in the dashboard**, **which data
pipeline serves it**, **what you must fill in**, and **how to verify** that the
numbers shown are the client's real data — nothing assumed, generated, or
synthesized.

> Golden rule: every number on the dashboard must trace back to a live query
> against a real source. If a module has no verified source for a client, it
> returns **empty** — it never re-labels another module's data.

---

## 1. The mental model: email domain → tenant → pipeline

A user logs in with an email. The dashboard resolves **which pipeline** owns that
user purely from the **email domain** (`lib/org-type.ts` → `resolveOrgType`):

| Order | Pipeline | How the user is matched | Data source |
|------|----------|--------------------------|-------------|
| 1 | `banco` | domain ∈ `BANCO_EMAIL_DOMAINS` | `coach_app` banco tables via SQL bridge |
| 2 | `pharma` | domain ∈ `PHARMA_TENANT_DOMAINS` (or DB domain map) | per-tenant bridge on `serv.aux-rolplay.com` |
| 3 | `analytics` | `customer_id > 0` (resolved from `coach_app.coach_users`) | `rolplay_pro_analytics` via SQL bridge |
| 4 | `none` | no match | empty dashboard |

**Second Brain** is orthogonal: it is fetched separately by `admin_email`
(derived from the user's domain — `admin@{domain}`) regardless of pipeline, and
appears on its own page.

So "creating a client" = **making the client's email domain resolve to a tenant
that has a working data source.**

---

## 2. The four data sources (and the raw SQL bridge)

### 2a. `analytics` — `rolplay_pro_analytics` (SQL bridge)
- Bridge: `BRIDGE_URL` (`POST { sql, params }`, header `X-Bridge-Key: BRIDGE_SECRET`).
- Every query is scoped `WHERE customer_id = ?` (tenant isolation).
- Session = `report_field_current.saved_report_id`; score from `field_key IN ('overall_score','final_score')`; pass from `coach_app.saved_reports.passed_flag`.
- Used by clients that live in the standard coach app (e.g. Takeda, Besins).

### 2b. `pharma` — per-tenant bridges on `serv.aux-rolplay.com`
Configured in `lib/pharma-tenant.ts` → `TENANT_CONFIG`. **Three kinds:**

| kind | Who | Transport | Session source |
|------|-----|-----------|----------------|
| `kpi` | Apotex | `POST {action:"kpi.*"}` to `…/unified/<tenant>/bridge/` | `kpi.overview` / `kpi.activity_summary` / `kpi.sessions` |
| `sale_exercises` | Sanfer, Weser, Adium | `POST {action:"sim.demorp6", ids, date_from, date_to}` | raw per-session rows, aggregated in-app |
| `exceltis_rest` | Heineken, M8, Lacoste, Chiesi, Labomed | `GET /api/rol_play_sim_extractor?id=…&fecha_inicio=…` | Flask REST rows |

Module split (Simulador / Coach Maestro / Certificación) must be **genuinely
different data**, never the same numbers reshuffled:
- **Apotex** Coach Maestro = `activity_id ∈ {8,9,10}` (verified against
  `kpi.activity_summary` — `activity_type = "Coach maestro"`). Everything else is
  Simulador.
- **Sanfer** Certificación = a **wholly separate source** (`cert.stats` /
  `org.certification` on the official platform DB), not a filtered view of
  sessions.
- `lms` / `second-brain` have **no** pharma source → always empty.

### 2c. `banco` — `coach_app` banco tables (SQL bridge)
- Domain-matched (`BANCO_EMAIL_DOMAINS`). Uses `banco_users` + `saved_reports.banco_user_id`.
- ⚠️ **Status (2026-07): these tables are not present on the live bridge** — see
  `docs/DATA_AUDIT.md`. Confirm the banco source before onboarding a banco client.

### 2d. Raw SQL bridge — `https://rolplay.app/ajax/remote-access.php`
- `POST {"sql":"SELECT …"}`, **SELECT-only** (enforced server-side).
- This is the **source-of-truth app DB** (`r_client`, users, sessions).
- Use it to **verify** onboarding and to look up a client's real IDs — not as a
  live dashboard data path.

---

## 3. Two ways to create a client

### Option A — Admin wizard (no code change) — preferred
1. Sign in as an **admin** user, go to `/admin/tenants`.
2. Fill the wizard:
   - **Tenant key** (slug, e.g. `acme`) and **email domain(s)** (e.g. `acme.com`).
   - **Kind**: `kpi` | `sale_exercises` | `exceltis_rest`.
   - **Bridge URL** (+ `X-Tenant` header value if the bridge needs it).
   - **ucids**: the client's real usecase/exercise ID allowlist (see §4).
   - **coachActivityIds** (only `kpi` tenants with a real Coach-Maestro split).
   - **has\*** flags (`hasCertification`, `hasObjections`, `hasBusinessLines`,
     `hasOrganization`, `hasTopStats`) — set **only** where a real source is confirmed.
   - Optional per-tenant auth header for endpoints on other servers.
3. Save → written to Postgres `pharma_tenants` + domain map, merged over the
   in-code defaults within ~30s (`lib/db-tenants.ts` + `ensureDynamicTenantsLoaded`).

### Option B — Code + env (for the hand-verified core tenants)
1. Add the domain to `PHARMA_TENANT_DOMAINS` env: `…,acme:acme.com`.
2. Add an entry to `TENANT_CONFIG` in `lib/pharma-tenant.ts` with the same fields.
3. Redeploy.

For an `analytics` client there's nothing to configure — the user just needs a
row in `coach_app.coach_users` with a `customer_id > 0`; login resolves the rest.

---

## 4. How to find the values you must fill (from the DB, not by guessing)

**`ucids` (usecase/exercise allowlist)** — must match the client's *real* scope.
Guessing "all usecases" silently inflates totals. Get them from the source:

```bash
# via the raw SQL bridge — distinct usecases actually recorded for a client
curl -s -X POST https://rolplay.app/ajax/remote-access.php \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT DISTINCT saex_useCases FROM sale_exercises WHERE saex_rp_client = '\''acme'\''"}'
```

**`coachActivityIds`** — the real Coach-Maestro activities (kpi tenants):

```bash
curl -s -X POST https://serv.aux-rolplay.com/unified/acme/bridge/ \
  -H "Content-Type: application/json" -H "X-Tenant: acme" \
  -d '{"action":"kpi.activity_summary","date_from":"2015-01-01","date_to":"2035-12-31"}'
# → use activity_id where activity_type == "Coach maestro"
```

---

## 5. Verifying a client end-to-end (do this every time)

1. **Ground-truth the total** straight from the tenant bridge (all-time):
   ```bash
   # kpi tenant
   curl -s -X POST https://serv.aux-rolplay.com/unified/acme/bridge/ \
     -H "Content-Type: application/json" -H "X-Tenant: acme" \
     -d '{"action":"kpi.overview","date_from":"2015-01-01","date_to":"2035-12-31"}'
   ```
2. **Log in** as a user on that domain → the dashboard **Overview** total must
   match the ground-truth number (the default date range now **snaps to the
   tenant's real data span** — see §6, so you should see the full history, not a
   trailing window).
3. **Spot-check a drilldown**: open one session; every field must be real data
   from the bridge (score, activity, feedback) — no placeholders.
4. **Module tabs**: confirm each module shows *different* numbers where a real
   split exists, and **empty** where it doesn't (never duplicated data).

---

## 6. Default date range = the tenant's real data span

The dashboard used to default to **last 30 days**, which hid almost everything
for clients whose activity wasn't in the trailing month (e.g. Apotex: 772 real
sessions across Oct 2025–Jun 2026 showed as ~3). Now:

- On first login, the client calls `GET /api/dashboard/data-bounds`, which
  returns the tenant's real `{ from, to }` (min/max session date) per pipeline,
  and the date picker **snaps** to it once (`lib/hooks/useSnapDateRange.ts`).
- If bounds are unavailable (or the user changes the picker), it falls back to a
  **24-month** rolling window (`lib/store.ts`).

This is why a freshly onboarded client shows its **entire** dataset immediately.

---

## 7. Checklist

- [ ] Domain resolves to the intended tenant (`resolveOrgType` / `resolvePharmaTenant`).
- [ ] `kind` + bridge URL correct; bridge reachable (curl returns `ok:true`).
- [ ] `ucids` taken from the DB, not assumed.
- [ ] `coachActivityIds` / `has*` flags set **only** where a real source exists.
- [ ] Overview total matches the bridge's all-time ground truth.
- [ ] Drilldown shows real per-session fields.
- [ ] Modules with no source render empty (not duplicated data).
