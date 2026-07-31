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
- [x] `S2` SQL transport — client-side hardening DONE (read-only guard rejecting non-SELECT and stacked statements; `X-Rolplay-Auth` sent when `ROLPLAY_APP_SQL_TOKEN` is set, so cutover needs no deploy, if ever wanted). **The server-side fix (auth on `remote-access.php`) is a knowingly accepted risk, not pursued — see B3.**
- [x] `S6` (new, found in a full re-audit 2026-07-31) **ai-service had zero auth of its own.** Deployed on Render as a public `type: web` service; `app/main.py` only configures CORS (browser-only protection, does nothing against a direct/curl call to the service's own URL). Anyone who found its Render URL could call `generate-dashboard`/`publish`/`knowledge/{slug}` DELETE directly, bypassing the Next.js proxy's admin gate entirely. **Fixed:** shared-secret gate (`X-Internal-Auth` / `INTERNAL_SHARED_SECRET`) on every `/ai/*` route, sent by the proxy when `AI_SERVICE_SHARED_SECRET` is set. Unenforced when unset, matching the existing `BRIDGE_SECRET` pattern — **you must set both env vars in production or this gap remains open.** 6+2 tests.
- [ ] `A4` Redis-backed shared cache + pub/sub invalidation — **needs a Redis instance** (see B5). Re-confirmed 2026-07-31: zero Redis references anywhere in either codebase.
- [~] Connector Interface — `lib/connectors/types.ts` defined; **rolplay-app connector done** as a pure adapter over the unmodified bridge module (22 tests asserting numeric equivalence). Remaining: pharma-bridge, banco-second-brain, exceltis-rest, learnworlds-lms adapters, then the registry + route cutover.
- [ ] Capability Engine (generalise `/api/dashboard/modules`)
- [ ] Metadata + Semantic layer · KPI Registry · Version Manager — re-confirmed 2026-07-31: `DiscoveredMetric`/`ServiceDescriptor` (ai-service/app/models.py) carry no confidence/evidence fields; no semantic-mapping structure exists anywhere (only the fixed 5-module journey ontology below). `DashboardConfig.version` increments on publish and prior configs land in `dashboard_versions`, but nothing reads that table back — publish has no rollback.
- [x] Journey engine (generalise `lib/journey.ts`) — **done for evidence-backed connectors, 2026-07-31.** `ai-service/app/journey.py` ports the canonical LMS→Coach→Simulator→Certification→Second-Brain order/phases; a `journey` widget is generated deterministically (never LLM-proposed) only when a connector's discovered modules are ALL canonical names (today: `rolplay_app_sql`, via its existing `r_simulator.category` mapping) and there are ≥2 of them. `pharma_kpi` (raw `activity_type` strings) and `coach_app_sql` (no module discovery at all) explicitly decline rather than guess. 13+ tests; live-verified on Siigo/Takeda (correctly omitted — each has only 1 real module in the current data window).
- [ ] `A5` Collapse per-route `orgType` branching onto the interface

---

## Phase 3 — Self-service platform `[ ]`
Onboarding wizard · connector/schema/metric/KPI/journey/capability discovery · widget + dashboard recommendation · brand discovery · preview · publish · rollback · versioning. **Success test: onboard a tenant end-to-end with zero redeploy.**

## Phase 4 — Dashboard Builder `[~]`
Metadata-driven generation (never hand-written React): KPIs · widgets · layout · filters · drilldowns · branding · journey · validate · preview · publish · version · rollback.

**Re-audited 2026-07-31 — substantial progress, but a real product gap found:**
- [x] KPIs, bar/line/donut/histogram/table/journey widgets, filters (metadata field exists), validate, preview, publish (writes domain routing) — all real, live-verified with real data across `rolplay_app_sql`/`pharma_kpi`/`coach_app_sql`.
- [x] Widget Registry is complete — all 7 `WidgetType` values have a matching renderer in `DashboardRenderer.tsx`, confirmed by direct comparison.
- [ ] **Drilldowns: absent.** No AI-generated widget has a click-through anywhere (confirmed: zero `Link`/`onClick` in `DashboardRenderer.tsx`) — the hand-built `/drilldown/[id]` page is not wired to anything the builder produces.
- [ ] **Version/rollback: write-only.** `dashboard_versions` gets a row every publish, but nothing reads it back — there is no rollback path today.
- [ ] **Branding: hardcoded, not per-tenant.** `dashboard_config.py` sets `branding={"primary_color": "#DC2626"}` literally for every tenant; it never reads `lib/db-branding.ts`'s real per-tenant values.
- [x] **Page Generator is now multi-page and capability-driven, 2026-07-31.** `DashboardConfig.pages: list[DashboardPage]` replaces the single flat `rows` list (kept only for back-compat). `dashboard_planning.py`'s `_assemble_pages()` composes `[overview] + [lms if discovered] + [per-module pages if the connector supports it]` — **page count is an output of discovery, not a hardcoded number.** Live-verified same code, same run, two different tenants: Siigo (`rolplay_app_sql`, 1 canonical module) → 2 pages ("Overview", "Practice Simulator"); Apotex (`pharma_kpi`, 3 raw activity_type modules, no canonical mapping) → 1 page before LMS was live, 2 pages ("Overview", "LMS") after. `DashboardRenderer.tsx` renders a real tab bar (`role="tablist"`) when `pages.length > 1`, falls back to flat rows otherwise. **Known scope limit, not hidden:** per-module scoped pages (Coach-only / Simulator-only / etc., each with its own filtered KPIs) only fire for `rolplay_app_sql`, because `journey_lib.CATEGORY_TO_MODULE` is the only connector with a verified, non-guessed mapping from raw activity strings to canonical module names — `pharma_kpi` tenants (Apotex) do not get per-module pages until such a mapping is verified for that connector; guessing one was explicitly rejected rather than silently done.
- [x] **Real LearnWorlds LMS integration, 2026-07-31.** `ai-service/app/lms.py` (OAuth2 client-credentials, courses/users/progress aggregation, bounded concurrency) is a straight port of the already-working `lib/lms-learnworlds.ts`, wired in as an independent discovery step (`agents/lms_discovery.py`) that only ever *adds* metrics/a page — it never blocks or reshapes the rest of the run if LMS isn't configured for a tenant. Live-verified for Apotex: real numbers rendering (41 enrolled users, 16 modules completed, 5.40% completion rate, quiz score honestly shown as "no data" rather than a fake 0). One real bug found and fixed live: `httpx` rejected a stored access_token with a trailing `\n` as an "Illegal header value" (Node's `fetch`, used by the TS version, tolerates it) — fixed by stripping whitespace/control chars from every credential field before it's used in a header (`705d11b`); this confirmed the encryption/credential-resolution pipeline itself was already correct end-to-end.
- [x] **Published dashboards are now shown to real tenant users, 2026-07-31 — product decision made: publish → visible.** Added `app/api/dashboard-view/[slug]/route.ts`: any authenticated user may view a published dashboard, gated on their resolved tenant actually owning the slug (`resolvePharmaTenant`/`resolveRolplayAppAccess` — the exact same isolation functions the rest of the app already uses, never a new rule). Admins can view any dashboard. Connectors with no verified per-user resolver against a slug (`coach_app_sql`) are denied rather than guessed at — a real remaining gap, not silently allowed. `dashboard_metadata` read directly via `authQuery` (same Postgres auth DB `ai-service` already writes to); live data fetched server-to-server via the `S6` internal secret. 10 tests. **Not yet live-verified end-to-end as a real non-admin tenant user** — needs a redeploy + a dashboard actually published to test against.

**On the "generic architecture" question (2026-07-31):** a request came in to build the full generic Analytics Builder Orchestrator spec (formal Connection Registry, Semantic Layer with confidence scoring, Capability Engine with VERIFIED/PROBABLE/UNVERIFIED/UNAVAILABLE states, Application Planner as a distinct reasoning component, Organization Engine, Report Generator, versioned rollback, etc.) in one pass. That full spec is **not built** — it's a large, multi-phase platform, not a single change. What *is* true today, checked directly rather than assumed: (1) an anti-hardcoding grep across every new file this phase (`lms.py`, `secret_crypto.py`, `tenant_credentials.py`, `lms_discovery.py`, `dashboard_planning.py`, `journey.py`, `preview_fetch.py`, `models.py`) for `apotex|siigo|takeda|m8` found zero tenant-specific branching — the 2 hits were both in pre-existing comments, not logic; (2) the cross-tenant page-count proof above (Siigo vs. Apotex, same code, different discovered capabilities, different page count) is a real, live instance of the "page composition is planned, not hardcoded" property the spec asks for, even though the *planner* doing that composition today is a set of Python functions in `dashboard_planning.py`, not the formal multi-stage engine described in the spec. The gap between "capability-driven output, verified on 2 real tenants" and "the full generic orchestrator with confidence-scored semantic mappings and a self-service onboarding workflow" is real and tracked as Phase 3 above, not closed.

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

**BLOCKED — needs external access I do not have:** Render dashboard/env/database, and the production secret store. (Corrected 2026-07-31: the FastAPI ai-service is NOT a separate external repo — it's `ai-service/` in this same checkout, and has been directly audited and modified this session.) I can produce every artefact (Dockerfiles, compose, probes, migration runbooks, deploy scripts) and validate them locally, but I cannot execute or verify a production deployment, or set Render env vars myself. Deploying is yours.

---

## Known blockers

| # | Blocker | Blocks | Smallest next action |
|---|---|---|---|
| B1 | No access to Render env/DB | Phase 11 | Still open for Phase 11 (Docker/migrations/scaling) generally; the specific "verify the Apotex LMS fix" instance of this is **resolved** — live-tested via the deployed dashboard-builder UI on 2026-07-31, no direct Render/DB access needed for that particular check. |
| B2 | ~~FastAPI AI service is outside this repo~~ **STALE — it's `ai-service/` in this same repo,** extensively audited and modified since this was written (donut/pass-fail/journey widgets, the S6 auth gate, etc.). Its auth (S6, fixed), resumability (in-memory only — see below), and orchestration ARE now audited. | — | — |
| B3 | **RISK KNOWINGLY ACCEPTED, 2026-07-31 — not a to-do, do not re-flag as urgent.** `remote-access.php` (rolplay.app) executes arbitrary SQL over HTTP with no authentication (client sends only Content-Type; default host is public and hardcoded) — confirmed live by independent code audit. Explained plainly to the product owner: "SELECT-only" is enforced only by this app's own client-side guard, not by the server, so anyone who finds the endpoint could send any SQL, not just reads. Decision: accepted as-is, no change requested to `remote-access.php`. | Production data confidentiality (accepted) | None — do not act on this without a new explicit request. The client-side mitigation already in place (read-only guard + ready-to-send `X-Rolplay-Auth` if `ROLPLAY_APP_SQL_TOKEN` is ever set) stays as a no-cost floor, but the server-side fix is deliberately not being pursued. |
| B4 | ~~Secret manager undecided~~ **RESOLVED: Render secrets**, adapted to envelope encryption (one master key in Render, per-tenant ciphertext in Postgres) because Render secrets alone still require a redeploy per tenant | — | Set `SECRET_ENCRYPTION_KEY` (`openssl rand -base64 32`) and run migrations 006 + 007 |
| B5 | No Redis instance provisioned | `A4`, Phase 6 caching, Phase 12 live sync | Provision Redis and give me the URL; I'll build the abstraction with an in-process fallback meanwhile |
| B6 | (new) **ai-service builder state is in-memory only** (`ai-service/app/jobs.py`'s `_JOBS: dict`) — a process restart silently loses every in-flight and completed job. A second, formal LangGraph orchestrator exists (`ai-service/app/graph.py`) but is dead code — `jobs.py` explicitly avoids it due to an unresolved bug where its conditional edges re-execute early nodes and hang indefinitely. | Phase 4's "Builder runs are resumable" criterion; horizontal scaling of ai-service | Either fix `graph.py`'s re-execution bug and cut over, or delete it to stop it misleading future work — plus persist `JobState` to Postgres (the DB is already reachable from ai-service) so a restart doesn't lose in-flight builds. |
| B7 | (new) No Playwright E2E, no CI pipeline (`.github/workflows` doesn't exist; Render's build steps don't run either test suite) | Phases 9–10; confidence that a deploy didn't break something a human would have caught by clicking through | Decide whether GitHub Actions or another CI host is acceptable, and whether Playwright is worth the setup cost now vs. later |

---

## Completion criteria

| Criterion | Status |
|---|---|
| All critical audit findings resolved | `[~]` Phase 1 done; `S2`/`S3`/`A1`–`A4` in Phase 2 |
| Zero failing tests | `[x]` 361/361 (305 vitest + 56 pytest, re-verified 2026-07-31) |
| Zero TypeScript errors | `[x]` |
| Zero ESLint errors | `[x]` clean on all changed files; full-repo sweep pending |
| Zero build warnings | `[ ]` not yet verified |
| Zero security vulnerabilities | `[~]` All in-repo P0/P1 closed (`S1`/`S3`–`S6`/`A1`–`A2`). `S2` (rolplay.app SQL endpoint) is a knowingly accepted risk, not a gap — see B3. |
| Self-service onboarding works | `[ ]` Phase 3 — blocked on A1/A2 |
| Publish / rollback / journey / progress work | `[ ]` Phases 3–4 |
| Tenant isolation verified | `[ ]` Phase 1 tests |
| Full E2E suite passes | `[ ]` Phase 10 |
| Production deployment successful | `[!]` B1 — cannot be done by me |
| Final architecture report | `[ ]` after Phase 10 |
