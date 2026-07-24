# Tenant isolation & authorization

How the unified dashboard guarantees a user of one client can never see another
client's data — especially between rival companies.

## The model: resolve tenant → verify authorization → serve only that tenant

Every request carries a JWT (HTTP-only cookie) with `email` + `customer_id`.
`resolveOrgType(email, customerId)` decides which **pipeline** a user belongs to,
in priority order (`lib/org-type.ts`):

1. **banco** — `isBancoOrg(email)` (coppel / bancoppel domains) → banco + Second Brain
2. **pharma** — `resolvePharmaTenant(email)` (Mexico bridge; domain → tenant) → that tenant's bridge only
3. **rolplay-app** — `resolveRolplayAppClientId(email)` (query endpoint; domain → client_id)
4. **analytics** — `customer_id > 0` (coach_app)
5. **none** — no access → "not linked" screen

Each pipeline is scoped to a single identifier (pharma tenant key, rolplay
`client_id`, or coach `customer_id`), so a request can only ever read that one
tenant's data. There is no endpoint that returns cross-tenant data to a
non-admin session.

## Domain ≠ authorization (the important part)

Resolving a tenant by email **domain** is convenient but is NOT proof the user
is authorized — anyone could self-register `intruder@siigo.com` and would
otherwise inherit Siigo's data. So for the query-endpoint platform (where rival
companies like Siigo live and the risk is highest) access is granted only when
the email is a **real user of that client**:

- `resolveRolplayAppAccess(email)` (`lib/bridge-rolplay-app.ts`) resolves the
  candidate `client_id` by domain, then verifies `email` exists in `r_user` for
  that `client_id` (cached). It returns the `client_id` only for an authorized
  user, else `null`.
- Enforced at **every** access point: `/api/auth/access-status` (`hasRolplayAppAccess`
  gates the whole dashboard) **and** each data route (overview / results / trends /
  usecase-breakdown / best-performers / data-bounds) — so a direct API call can't
  bypass the screen gate.
- Verified against live data: `adriana.losada@siigo.com` → allowed (real Siigo
  user); a fabricated `@siigo.com` address → denied.
- Built-in demo logins (`demo@siigo.com`, …) intentionally bypass the DB check.

## `customer_id = 0` collision (fixed)

`customer_id` resolves only from coach_app; for pharma / rolplay-app / Second
Brain tenants it is `0`. Anything keyed by `customer_id` alone therefore shares
one row across all those tenants. This bit **branding** (one client's logo/colors
showed for others) — fixed by keying branding on a stable per-tenant string
(`cust:<id>` for coach tenants, else `domain:<email-domain>`); see
`migrations/004_branding_tenant_key.sql`. When adding any new per-tenant stored
setting, key it the same way, never by `customer_id` alone.

## Verification checklist (needs 2 rival logins)
1. Log in as client A user → confirm only A's data (KPIs, tables, branding).
2. Log in as rival client B user → confirm only B's data; nothing from A.
3. Self-register a fake address on A's domain that is NOT a real A user →
   confirm "not linked" (denied), no data.

## Out of scope / follow-ups
- Hierarchy-based visibility *within* a single client (separate ticket).
- Authorized-user verification for **pharma** and **banco** tenants (same idea,
  verified against their own source user lists) — rolplay-app is done; extend
  when those platforms are in focus.
