# Demo Runbook — Unified Dashboard

Everything below is **live data from each client's real source**. Nothing is
synthesized. Production URL: `https://rolplaypro-dashboard.onrender.com`.

> The core story: **one login → the dashboard auto-detects which client you are
> from your email domain, routes to that client's real data source, and snaps
> the date range to that client's full history.** Every client's modules show
> genuinely different data — never the same numbers relabeled.

---

## 0. Pre-demo checklist (5 min before)

1. Confirm the latest build is live:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     https://rolplaypro-dashboard.onrender.com/api/dashboard/data-bounds
   # 401 = deployed (route exists, needs auth). 404 = old build still deploying.
   ```
2. Have **one login per client you'll show** (email on that client's domain +
   password). The domain is what selects the client — see the roster.
3. If Render was idle, load the site once to wake it (free tier cold start ~30s).

---

## 1. Client roster — what to show, and the real numbers to expect

| Client | Login domain | Pipeline | Headline (all-time, real) | What to highlight |
|--------|--------------|----------|---------------------------|-------------------|
| **Apotex** | `@apotex.com` | pharma `kpi` | **772 sessions**, avg 61.0, 64.5% pass | Coach Maestro vs Simulador = *different* activities (8/9/10 vs rest) |
| **Sanfer** | `@sanfer.com.mx` | pharma `sale_exercises` + cert | **3,833 practice records** (avg 92); **858/915 certified (94%)** | Certification is a *separate* source; Objections; Business Lines; Organization |
| **Coppel** | `@coppel.com` | banco → **Second Brain** | **22 coaching sessions**, 17 members, 106 message logs | Conversational/coaching org — Second Brain page |
| **Takeda** (standard) | `@takeda.com` | `analytics` | ~68 sessions | Standard coach-app analytics via customer_id |
| Heineken / M8 / Lacoste / Chiesi / Labomed | resp. domains | pharma `exceltis_rest` | verify live (see §4) | Bespoke REST clients, per-client fields in drilldown |

*(Numbers verified against each source on 2026-07-15; they only grow as users train.)*

---

## 2. The end-to-end flow to demo for EACH user (2–3 min each)

1. **Log in** at `/auth/login` with a user on that client's domain.
   → Talking point: "The dashboard identifies the client purely from the email
   domain — no per-client build."
2. **Overview loads on the client's full history automatically.**
   → The date range **snaps to the client's real data span** (e.g. Apotex opens
   on Oct 2025 – Jun 2026, showing all 772 — not an empty 'last 30 days').
   → Read the KPI cards: Total sessions / Avg score / Pass rate — all live.
3. **Switch modules** (Simulador / Coach Maestro / Certificación):
   → Each shows **different** real data. For Apotex, Coach Maestro (3 activities)
   ≠ Simulador. For Sanfer, Certificación comes from the official platform DB.
   → Modules a client doesn't have show **empty** — that's honesty, not a bug.
4. **Open a drilldown** (click a session): every field (score, activity,
   feedback, Q&A rounds) is the real recorded session — no placeholders.
5. **Change the date range** to narrow → numbers recompute live from the source.

**Coppel is the "conversational" story:** log in `@coppel.com` → Overview shows
coaching sessions; open the **Second Brain** page → org "Coppel", members,
message logs, WhatsApp activity — all from the Second Brain API.

---

## 3. Creating a NEW client — live (3–4 min)

Use the **admin wizard** (no code, no redeploy). Full reference:
[`docs/ONBOARDING_A_CLIENT.md`](./ONBOARDING_A_CLIENT.md).

1. Sign in as an **admin**, go to **`/admin/tenants`** → **New tenant**.
2. Fill:
   - **Tenant key**: slug, e.g. `acme`.
   - **Email domain(s)**: e.g. `acme.com` (this is how logins route to it).
   - **Kind**: `kpi` (Apotex-style) · `sale_exercises` (Sanfer-style) ·
     `exceltis_rest` (Heineken-style).
   - **Bridge URL** (+ `X-Tenant` header if the bridge needs it).
   - **ucids**: the client's real usecase/exercise IDs (from the DB — never
     guessed; see the onboarding doc §4).
   - **Coach Maestro activity IDs** (only `kpi` clients that truly have that split).
   - **has\*** flags (certification / objections / business-lines / organization)
     — tick **only** where a real source exists.
3. **Save** → written to the `pharma_tenants` table + domain map; live within ~30s.
4. **Verify immediately** (do this on-stage — it's persuasive):
   ```bash
   # ground truth straight from the client's bridge
   curl -s -X POST https://serv.aux-rolplay.com/unified/acme/bridge/ \
     -H "Content-Type: application/json" -H "X-Tenant: acme" \
     -d '{"action":"kpi.overview","date_from":"2015-01-01","date_to":"2035-12-31"}'
   ```
5. **Log in** as a user on `acme.com` → the dashboard shows exactly that number.

> If you don't have a real bridge for the new client yet, you can still walk the
> wizard UI end-to-end; the dashboard will simply show empty until the bridge is
> reachable — which is the honest behavior.

---

## 4. Quick "prove it's real" one-liners (optional, for a technical audience)

```bash
# Apotex — all-time vs last-30-days (shows why the default now snaps to full span)
curl -s -X POST https://serv.aux-rolplay.com/unified/apotex/bridge/ \
  -H "Content-Type: application/json" -H "X-Tenant: apotex" \
  -d '{"action":"kpi.overview","date_from":"2015-01-01","date_to":"2035-12-31"}'   # total_sessions: 772

# Sanfer — certification (separate source) + all-time practice
curl -s -X POST https://serv.aux-rolplay.com/unified/sanfer/bridge/ \
  -H "Content-Type: application/json" -H "X-Tenant: sanfer" -d '{"action":"cert.stats"}'   # 915 total / 858 certified

# Coppel — Second Brain org profile
curl -s "https://second-brain-shz8.onrender.com/admin/api/organizations/full-profile?admin_email=admin1@coppel.com" \
  -H "Authorization: Bearer <SECOND_BRAIN_API_TOKEN>"   # organization: Coppel, 22 coaching sessions
```

---

## 5. If something looks empty on stage — quick triage

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Overview shows 0 / few | (pre-fix build) | Confirm build is live (§0); the fix snaps to full span |
| A module tab is empty | That client has no real source for it | Expected — pick a module the client has |
| Second Brain page error | admin email didn't resolve | Now falls back through candidates incl. env; confirm the org exists upstream |
| Whole dashboard empty | domain not mapped to a tenant | Check `/admin/tenants` domain map |
| Site slow to first load | Render free-tier cold start | Pre-warm before the demo (§0.3) |
