# New User Onboarding

How an end user gets a dashboard login and what determines the data they see.
(For adding a whole new **client/tenant**, see
[`ONBOARDING_A_CLIENT.md`](./ONBOARDING_A_CLIENT.md).)

---

## 1. The one rule that decides everything: the email

A user's **email address is their identity AND their routing key.** When they
register/log in, the dashboard reads the email and decides — with no per-user
config — which client's data they see:

```
email → resolveOrgType(email, customerId):
  1. domain ∈ BANCO_EMAIL_DOMAINS?        → banco  → Second Brain data
  2. domain ∈ pharma domain map?          → pharma → that tenant's bridge
  3. email in rolplay-app login map?      → rolplay-app → that client (counts-only)
  4. email found in coach_users (cid>0)?  → analytics → that customer_id's data
  5. otherwise                             → none → empty dashboard
```

So **onboarding a user = making sure their email lands in the right bucket:**

| Data source | What the user's email must be |
|-------------|-------------------------------|
| **Pharma** (Apotex, Sanfer, Heineken, M8, Lacoste, Chiesi, Labomed, Adium) | any address on the tenant's **domain** (e.g. `anyone@sanfer.com.mx`). The dashboard shows the **whole tenant**, so the specific address doesn't matter. |
| **Banco** (Coppel/BancoPPEL) | any address on a `BANCO_EMAIL_DOMAINS` domain (e.g. `anyone@coppel.com`) → Second Brain. |
| **Rolplay-app** (Siigo, …) | an address listed in `ROLPLAY_APP_LOGINS` (these clients share domains, so routing is by explicit email→client_id). |
| **Analytics** (Takeda, Besins) | the **exact** email that exists in `coach_users` — this is the only bucket where the specific address matters (customer_id is resolved from it). |

---

## 2. Two ways to onboard a user

### A. Self-service — the user registers themselves
1. Go to **`/auth/register`**.
2. Enter full name, email (on the right domain per §1), and a password meeting
   the rules (**≥8 chars, 1 upper, 1 lower, 1 number, 1 symbol**).
3. Submit → account created, logged in, routed to their org's data automatically.

### B. Admin/batch — provision many users at once (API)
Registration is a plain POST, so you can script it. This creates users with a
shared initial password (they can change it later):

```bash
BASE=https://rolplaypro-dashboard.onrender.com
PW='RolplayDemo2026!'          # meets the strength rules; change per your policy
users=(
  "ana.lopez@sanfer.com.mx|Ana Lopez"       # → Sanfer (pharma)
  "juan.perez@apotex.com|Juan Perez"        # → Apotex (pharma; .com or .com.mx both work)
  "maria.gomez@coppel.com|Maria Gomez"      # → Coppel (banco → Second Brain)
  "eleazar.palacios@takeda.com|Eleazar P."  # → Takeda (analytics; MUST be a real coach_users email)
)
for u in "${users[@]}"; do
  email="${u%%|*}"; name="${u##*|}"
  curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$PW\",\"full_name\":\"$name\"}" \
    -o /dev/null -w "$email -> %{http_code}\n"
done
# 200 = created · 409 = already exists (safe to ignore) · 400 = weak password / bad email
```

> **Security note:** a shared initial password is fine for a demo, but for real
> users have each person change it after first login (or issue unique passwords).

### Making an admin (needed only for the client-onboarding wizard)
Roles aren't self-serve — promote once in the auth DB:
```bash
psql "$AUTH_DATABASE_URL" -c "UPDATE users SET role='admin' WHERE email='you@yourco.com';"
```

---

## 3. Verify a user sees the right data (do this after provisioning)

1. Log in as the user → the **Overview total should be non-zero** and match the
   client (the date range auto-snaps to the client's full history).
2. Cross-check against the source (example, Sanfer):
   ```bash
   curl -s -X POST https://serv.aux-rolplay.com/unified/sanfer/bridge/ \
     -H "Content-Type: application/json" -H "X-Tenant: sanfer" -d '{"action":"cert.stats"}'
   ```
3. Confirm the number on screen equals the source number.

---

## 4. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Empty dashboard | email domain not mapped to any client | add the domain to the tenant in `/admin/tenants`, or check `BANCO_EMAIL_DOMAINS` |
| Analytics user empty | used a non-`coach_users` email | analytics resolves by exact email — use the real one |
| Rolplay-app user empty | email not in `ROLPLAY_APP_LOGINS` | add `email:client_id` to `ROLPLAY_APP_LOGINS` |
| `400` on register | password too weak / invalid email | meet the strength rules (§2A) |
| Avg Score / Pass Rate empty | client's source has no scores (e.g. Siigo) | expected — that platform is counts-only |

---

## 5. What each org shows (so you know it's really different data)

Every client is a different real data source — not the same numbers relabeled.
See the verified per-client headline numbers in
[`DEMO_RUNBOOK.md`](./DEMO_RUNBOOK.md) §1.
