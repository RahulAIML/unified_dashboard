# Rolplay Unified Analytics Platform — Production Roadmap

Living checklist. Updated as phases complete. See [docs/ARCHITECTURE_AUDIT.md](docs/ARCHITECTURE_AUDIT.md) for the findings this plan responds to.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` complete & tested · `[!]` blocked (reason given)

**Rules in force:** never break existing APIs · everything additive · no phase advances until tests pass · no TODOs or mock implementations left behind.

---

## Phase 0 — Validate the audit `[x]`

Verify every finding directly rather than trusting the report.

- [x] `S1` AI proxy unauthenticated — **CONFIRMED, and worse than written.** `app/api/ai/[...path]/route.ts` has no auth call, *and* `middleware.ts:26` does `if (pathname.startsWith('/api/')) return NextResponse.next()`, so middleware deliberately skips every API route. No gate at either layer.
- [x] `S2` SQL-string transport — CONFIRMED. `lib/bridge-rolplay-app.ts:41` POSTs `{sql}`; 11 interpolation sites. No live injection: `cid` via `Math.trunc()`, categories from a fixed map. Risk is structural, not active.
- [x] `S3` plaintext credentials — CONFIRMED. `migrations/003:39` `auth_header_value TEXT`, no encryption.
- [x] `S4` `/api/debug/second-brain-check` unauthenticated — CONFIRMED.
- [x] `S5` no rate limiting — CONFIRMED. No dependency, no middleware equivalent.
- [x] `A1` secrets keyed by env var name — CONFIRMED, with a reproduction: local (no `DATABASE_URL`) resolves key `apotex` and the LMS works (41 users / 299 enrollments / 15 courses); Render's DB supplies a different key so `LMS_APOTEX_*` is never read.
- [x] `A2` dual source of truth — CONFIRMED. `lib/pharma-tenant.ts:292` rebuilds config from a hand-maintained field list; `pharma_tenants` has no `has_lms` / `has_simulator` column.
- [x] `A3` no connector interface — CONFIRMED. `orgType` if/else dispatch repeated across routes.
- [x] `A4` in-process cache/state — CONFIRMED. Module-level mutables + 30s TTL; `invalidateDynamicTenantsCache()` is process-local.
- [x] Corrected while validating: `requireAdminFromRequest` **already exists** in `lib/server-auth.ts` and is used by `app/api/admin/tenants/route.ts`. Phase 1 reuses it — no new auth helper.

**Result: 9/9 findings upheld. One audit omission corrected (middleware skip makes S1 unambiguous).**

---

## Phase 1 — Security: all P0/P1 `[x]`

- [x] `S1` Admin required on `/api/ai/**` catch-all. **Verified live: 403 on POST and GET without a session.** (`app/api/ai/route.ts` was already authenticated — audit overstated the scope; corrected.)
- [x] `S4` `/api/debug/second-brain-check` admin-gated. **Verified live: 403.** Reclassified while fixing: it accepts an arbitrary `?email=`, so unauthenticated it was cross-tenant data disclosure by enumeration, not just debug exposure.
- [x] `S5` Rate limiting — login 20/min/IP, register 5/min/IP, AI 60/min/admin
- [x] Security headers — nosniff, DENY, Referrer-Policy, Permissions-Policy, HSTS (prod only). **Verified live on `/api/health`.**
- [x] Input validation at the AI proxy — path-traversal rejection, 256KB cap, JSON validation
- [x] Audit logging for AI mutations (admin + method + path; bodies excluded, they can carry credentials)
- [x] Tests — 8 proxy authorisation tests + 11 rate-limit tests
- [x] **Restored 26 dead API tests** — `vitest.config.ts` excluded `**/dashboard/**` for a root submodule, which also matched `app/api/dashboard/__tests__/`. Those tests had never run. Now anchored to the repo root; all 26 pass.
- [ ] CSP — **deliberately not shipped.** Next injects inline hydration scripts, so a correct policy needs per-request nonces threaded through the document. A broad `unsafe-inline` policy would pass an audit while blocking nothing. Needs its own change.
- [ ] `S3` Encrypted credential storage → **Phase 2**, lands with the credential store

**Gate: PASS.** 153 tests (108 → 153), tsc clean, eslint clean on all changed files, no unauthenticated mutating endpoint remains.

---

## Phase 2 — Architecture refactor `[~]`

Ordered so nothing is built against two sources of truth.

- [x] `S3`+`A1` Encrypted per-tenant credential store — AES-256-GCM envelope, master key in Render env, ciphertext in Postgres (`migrations/006`). `/api/admin/credentials` writes it; `GET` never returns values. LMS switched over: resolution no longer depends on an env var NAME matching the tenant key. Env fallback per field, so existing tenants are untouched. **27 + 10 tests.**
- [x] `A2` Capability drop is now a **compile error** — `satisfies Record<keyof TenantConfig, unknown>` on the merge; proven by adding a field and observing TS1360, then reverting. `migrations/007` adds the missing `has_lms` / `has_simulator` as **nullable** tri-state (a NOT NULL DEFAULT FALSE column would have disabled every tenant's Simulator tab). Write path wired through upsert + admin route with COALESCE. **14 tests.**
- [~] `S2` SQL transport — client-side hardening DONE (read-only guard rejecting non-SELECT and stacked statements; `X-Rolplay-Auth` sent when `ROLPLAY_APP_SQL_TOKEN` is set, so cutover needs no deploy). **The server-side fix is NOT in this repo — see B3, now escalated.**
- [ ] `A4` Redis-backed shared cache + pub/sub invalidation — **needs a Redis instance** (see B5)
- [ ] Connector Interface + SDK — wrap the 4 existing bridges **unchanged** first (pure code, no blocker)
- [ ] Capability Engine (generalise `/api/dashboard/modules`)
- [ ] Metadata + Semantic layer · KPI Registry · Version Manager
- [ ] Journey / Progress / Dependency engines (generalise `lib/journey.ts`)
- [ ] `A5` Collapse per-route `orgType` branching onto the interface

---

## Phase 3 — Self-service platform `[ ]`
Onboarding wizard · connector/schema/metric/KPI/journey/capability discovery · widget + dashboard recommendation · brand discovery · preview · publish · rollback · versioning. **Success test: onboard a tenant end-to-end with zero redeploy.**

## Phase 4 — Dashboard Builder `[ ]`
Metadata-driven generation (never hand-written React): KPIs · widgets · layout · filters · drilldowns · branding · journey · validate · preview · publish · version · rollback.

## Phase 5 — AI layer `[ ]`
Insight · recommendation · executive summary · weekly report · risk detection · trend + root-cause analysis · NL dashboard / Q&A.

## Phase 6 — Performance `[ ]`
Redis · queue + background jobs · streaming · pagination · lazy load · batching · request coalescing · compression · profiling. **Known target: `/api/dashboard/lms` cold call measured at 14.2s.**

## Phase 7 — Observability `[ ]`
OpenTelemetry · Prometheus · tracing · health checks (incl. connector health) · alerting · structured logging · audit logs. **Priority: log *why* a capability was included/excluded — today's LMS bug was invisible without it.**

## Phase 8 — Developer experience `[ ]`
Architecture/API/connector/DB docs · sequence + flow diagrams · ADRs · CLI · connector/code/mock/type generators.

## Phase 9 — Testing `[ ]`
Unit · integration · API · component · E2E · performance · regression · a11y · cross-browser · security · load.

## Phase 10 — E2E validation (Playwright) `[ ]`
Screenshots, videos, traces, HTML reports, retries. Every page/API/workflow/tenant.

## Phase 11 — Production validation `[!]`
Docker · migrations · cold start · horizontal scaling · autoscaling · zero downtime · blue-green · backups · recovery · probes · Render deploy.

**BLOCKED — needs external access I do not have:** Render dashboard/env/database, the production secret store, and the FastAPI AI service repo. I can produce every artefact (Dockerfiles, compose, probes, migration runbooks, deploy scripts) and validate them locally, but I cannot execute or verify a production deployment. Deploying is yours.

---

## Known blockers

| # | Blocker | Blocks | Smallest next action |
|---|---|---|---|
| B1 | No access to Render env/DB | Phase 11; verifying the Apotex LMS fix | You paste `/api/dashboard/lms` response (`lmsEnvPrefix`, `tenantKey`, `configured`) |
| B2 | FastAPI AI service is outside this repo | Phases 4–5 completeness; its auth/resumability unaudited | Point me at that repo, or confirm it's out of scope |
| B3 | **ESCALATED — CONFIRMED LIVE.** Internet-reachable endpoint executing SQL on the production DB with no authentication (client sends only Content-Type; default host is public and hardcoded). "SELECT-only" was a comment, not verified code. | Production data confidentiality | **Today:** require the shared secret in `remote-access.php` + IP-allowlist. The client already sends `X-Rolplay-Auth` once `ROLPLAY_APP_SQL_TOKEN` is set. |
| B4 | ~~Secret manager undecided~~ **RESOLVED: Render secrets**, adapted to envelope encryption (one master key in Render, per-tenant ciphertext in Postgres) because Render secrets alone still require a redeploy per tenant | — | Set `SECRET_ENCRYPTION_KEY` (`openssl rand -base64 32`) and run migrations 006 + 007 |
| B5 | No Redis instance provisioned | `A4`, Phase 6 caching, Phase 12 live sync | Provision Redis and give me the URL; I'll build the abstraction with an in-process fallback meanwhile |

---

## Completion criteria

| Criterion | Status |
|---|---|
| All critical audit findings resolved | `[~]` Phase 1 done; `S2`/`S3`/`A1`–`A4` in Phase 2 |
| Zero failing tests | `[x]` 210/210 |
| Zero TypeScript errors | `[x]` |
| Zero ESLint errors | `[x]` clean on all changed files; full-repo sweep pending |
| Zero build warnings | `[ ]` not yet verified |
| Zero security vulnerabilities | `[~]` P0 closed; `S2`/`S3` are Phase 2 |
| Self-service onboarding works | `[ ]` Phase 3 — blocked on A1/A2 |
| Publish / rollback / journey / progress work | `[ ]` Phases 3–4 |
| Tenant isolation verified | `[ ]` Phase 1 tests |
| Full E2E suite passes | `[ ]` Phase 10 |
| Production deployment successful | `[!]` B1 — cannot be done by me |
| Final architecture report | `[ ]` after Phase 10 |
