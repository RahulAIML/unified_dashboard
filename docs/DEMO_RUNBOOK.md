# Demo Runbook — Unified Dashboard

Production: **https://rolplaypro-dashboard.onrender.com**
Admin portal: **https://rolplaypro-dashboard.onrender.com/admin/tenants**

Everything below is **live data from each client's real source** — nothing
synthesized. All numbers were verified live on 2026-07-15 through the deployed
dashboard.

> The story: **one login → the dashboard detects the client from the email
> domain → routes to that client's real data source → snaps the date range to
> that client's full history.** Every client's modules show genuinely different
> data; a module with no real source shows empty (honest, not a bug).

---

## 1. Demo login accounts

**Shared password (meets the app's rules — 8+ chars, upper/lower/number/symbol):**
```
RolplayDemo2026!
```

| Client | Login email | Pipeline | Dashboard shows (verified live) |
|--------|-------------|----------|---------------------------------|
| **Apotex** | `demo@apotex.com` | pharma `kpi` | **772** sessions · Oct 2025–Jun 2026 · Coach Maestro vs Simulador split |
| **Sanfer** | `demo@sanfer.com.mx` | pharma `sale_exercises` | **9,198** practice sessions · **858/915 certified (94%)** · objections · business lines · org |
| **Heineken** | `demo@heineken.com` | pharma `exceltis_rest` | **626** sessions |
| **M8** | `demo@acino.swiss` | pharma `exceltis_rest` | **266** sessions |
| **Labomed** | `demo@itf-labomed.cl` | pharma `exceltis_rest` | **245** sessions |
| **Lacoste** | `demo@lacoste-rolplay.net` | pharma `exceltis_rest` | **161** sessions |
| **Chiesi** | `demo@chiesi.com` | pharma `exceltis_rest` | **36** sessions |
| **Adium** | `demo@adium.com.co` | pharma `sale_exercises` | **16** sessions |
| **Takeda** | `eleazar.palacios@takeda.com` | `analytics` | **68** sessions |
| **Besins** | `tjimenez@besins-healthcare.com` | `analytics` | **17** sessions |
| **Coppel** | `demo@coppel.com` | banco → **Second Brain** | **22** coaching sessions · 17 members · 106 message logs |
| **Siigo** | `demo@siigo.com` | `rolplay-app` (counts-only) | **89** sessions · 44 users · **scores not captured** (Avg/Pass show empty — honest) |

**Two routing rules (why the emails differ):**
- **Pharma & Banco** route by **email domain only** — the dashboard shows the
  *whole tenant's* data regardless of which user logs in. So a clean
  `demo@<domain>` is used, and it shows everything.
- **Analytics** (Takeda/Besins) resolves `customer_id` from the **exact email**
  in `coach_users`, so those must be the **real** emails above (a `demo@` on
  that domain would land in an empty dashboard).

> Real end users exist too (e.g. `asilva1@apotex.com.mx`, `lizeth.arteaga@sanfer.com.mx`,
> `ascanio.degracia@heineken.com`) and can log in directly. Apotex now accepts
> **both** `apotex.com` and `apotex.com.mx` (built-in alias), so real Apotex reps
> route correctly.
>
> **Siigo is counts-only:** it lives on the standalone Rolplay-app platform,
> where sessions are recorded but scores are not. It shows real session/user
> counts; Avg Score / Pass Rate are intentionally empty (never faked). Other
> module tabs will be empty for Siigo.

### Create the accounts (RUN THIS ONCE — creates the logins above)
```bash
BASE=https://rolplaypro-dashboard.onrender.com
PW='RolplayDemo2026!'
accounts=(
  "demo@apotex.com|Apotex Demo"
  "demo@sanfer.com.mx|Sanfer Demo"
  "demo@heineken.com|Heineken Demo"
  "demo@acino.swiss|M8 Demo"
  "demo@itf-labomed.cl|Labomed Demo"
  "demo@lacoste-rolplay.net|Lacoste Demo"
  "demo@chiesi.com|Chiesi Demo"
  "demo@adium.com.co|Adium Demo"
  "eleazar.palacios@takeda.com|Takeda Demo"
  "tjimenez@besins-healthcare.com|Besins Demo"
  "demo@coppel.com|Coppel Demo"
  "demo@siigo.com|Siigo Demo"
)
for a in "${accounts[@]}"; do
  email="${a%%|*}"; name="${a##*|}"
  curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PW\",\"full_name\":\"$name\"}" \
    -o /dev/null -w "$email -> %{http_code}\n"
done
# 200 = created, 409 = already exists (fine).
```

---

## 2. The end-to-end flow to demo per client (2–3 min each)

1. **Log in** at `/auth/login` with the client's email + shared password.
   → "The dashboard identified the client purely from the email domain."
2. **Overview loads on the client's full history automatically** — the date
   range **snaps to the real data span** (Apotex opens on Oct 2025–Jun 2026 and
   shows all 772, not an empty 'last 30 days').
3. **Switch module tabs** (Simulador / Coach Maestro / Certificación): each is
   **different** real data. Apotex Coach Maestro (3 activities) ≠ Simulador;
   Sanfer Certificación comes from the official platform DB.
4. **Open a drilldown** (click a session): real score, activity, feedback, Q&A.
5. **Coppel = the conversational story:** Overview shows coaching sessions; open
   the **Second Brain** page → org "Coppel", members, message/WhatsApp activity.

---

## 3. Admin portal — how it works & how to configure

**URL:** `https://rolplaypro-dashboard.onrender.com/admin/tenants`
Requires a user with **`role = 'admin'`**. There is no self-serve promotion, so
promote one account once (RUN THIS — needs the Postgres auth DB URL from Render):

```bash
# make your chosen login an admin (any email works for admin; role is independent of client)
psql "$AUTH_DATABASE_URL" -c "UPDATE users SET role='admin' WHERE email='demo@apotex.com';"
```
(`AUTH_DATABASE_URL` is in your Render env vars. Log out/in after promoting.)

**What the portal does:**
- **Lists** all tenants — `source: code` (the hand-verified ones in
  `lib/pharma-tenant.ts`) and `source: admin` (ones you add here).
- **New tenant** wizard — fields:
  - **Tenant key** (slug) + **email domain(s)** → domains route logins to this tenant.
  - **Kind**: `kpi` / `sale_exercises` / `exceltis_rest`.
  - **Bridge URL** (+ `X-Tenant` header value if needed).
  - **ucids** — the client's real usecase/exercise IDs (from the DB, not guessed).
  - **Coach Maestro activity IDs** (only `kpi` clients with a real split).
  - **has\*** flags (certification / objections / business-lines / organization).
- **Edit / deactivate** admin-created tenants; **add a domain** to an existing
  tenant (e.g. add `apotex.com.mx` to `apotex`).
- Changes are written to Postgres (`pharma_tenants` + domain map) and live in ~30s.

Full reference: [`docs/ONBOARDING_A_CLIENT.md`](./ONBOARDING_A_CLIENT.md).

---

## 4. Create a NEW client — live (3–4 min)

1. Admin → `/admin/tenants` → **New tenant**.
2. Fill: tenant key, email domain, kind, bridge URL, real `ucids`, flags.
3. **Save** → live in ~30s.
4. **Prove it on stage** — ground truth straight from the bridge:
   ```bash
   curl -s -X POST https://serv.aux-rolplay.com/unified/<key>/bridge/ \
     -H "Content-Type: application/json" -H "X-Tenant: <key>" \
     -d '{"action":"kpi.overview","date_from":"2015-01-01","date_to":"2035-12-31"}'
   ```
5. Register a `demo@<newdomain>` login (§1 script) → log in → dashboard matches.

---

## 5. "Prove it's real" one-liners (optional, technical audience)

```bash
# Apotex all-time (matches the 772 on screen)
curl -s -X POST https://serv.aux-rolplay.com/unified/apotex/bridge/ \
  -H "Content-Type: application/json" -H "X-Tenant: apotex" \
  -d '{"action":"kpi.overview","date_from":"2015-01-01","date_to":"2035-12-31"}'

# Sanfer certification (separate source)
curl -s -X POST https://serv.aux-rolplay.com/unified/sanfer/bridge/ \
  -H "Content-Type: application/json" -H "X-Tenant: sanfer" -d '{"action":"cert.stats"}'

# Coppel Second Brain org
curl -s "https://second-brain-shz8.onrender.com/admin/api/organizations/full-profile?admin_email=admin1@coppel.com" \
  -H "Authorization: Bearer <SECOND_BRAIN_API_TOKEN>"
```

---

## 6. Pre-demo checklist & triage

**Before you start:**
1. Confirm build live: `curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/dashboard/data-bounds` → **401** = live.
2. Run the §1 account script (once) and the §3 admin promotion (once).
3. Pre-warm the site (open it) — Render free tier cold-starts ~30s.

| Symptom | Cause | Fix |
|---------|-------|-----|
| Whole dashboard empty | email domain not mapped to a tenant | check `/admin/tenants` domain map (e.g. Apotex `.com.mx`) |
| Analytics client empty | used a `demo@` instead of the real coach_users email | use the exact emails in §1 |
| A module tab empty | client has no real source for it | pick a module the client has |
| Second Brain page error | admin email didn't resolve | now falls back through candidates incl. env — confirm org exists upstream |
| Slow first load | Render cold start | pre-warm (checklist #3) |
