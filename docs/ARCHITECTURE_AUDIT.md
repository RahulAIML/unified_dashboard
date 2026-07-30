# Rolplay Unified Analytics Platform — Phase 1 Architecture Audit

**Date:** 2026-07-29
**Scope:** `Rolplay_Dashboard_Project` @ `f05c906`
**Method:** static reading of the repo + live verification against the running dev server and real tenant data.
**Status:** audit only — no code was modified for this report.

---

## 0. Executive summary

The platform is a **working multi-tenant dashboard**, and genuinely good at what it currently does: four heterogeneous backends are unified behind one UI, capability-gated per tenant, with real branding and i18n. That part is not in question.

It is **not yet a self-service platform**, and the gap is not a missing feature list — it is one structural fact:

> **Tenant configuration and tenant secrets live partly in code and env vars, and partly in Postgres. Onboarding a customer therefore requires a redeploy.**

Until that is fixed, "no developer intervention" is unreachable no matter how many engines are added on top. Everything else in this report is downstream of it.

**Three findings block the stated vision outright:**

| # | Finding | Severity |
|---|---|---|
| S1 | The entire AI builder pipeline is **unauthenticated** | **P0 — security** |
| S2 | Arbitrary **SQL is sent as a string over HTTP** to a remote executor | **P0 — security** |
| A1 | Per-tenant secrets live in **env var names derived from the tenant key** | **P0 — blocks self-service** |

`A1` is not theoretical. It cost this session several hours: Apotex's LMS tab stayed hidden with correct credentials because the DB-assigned tenant key did not match the env var name. The same defect will hit every tenant onboarded by the builder.

---

## 1. What is genuinely solid

Worth stating plainly, because the refactor must not regress it:

- **Capability gating works.** `/api/dashboard/modules` → `useAvailableModules` → sidebar/filter means a tenant never sees a tab with no data. Verified live.
- **Four backends already unified**: `bridge-pharma-analytics`, `bridge-rolplay-app`, `banco-second-brain`, `exceltis-rest`.
- **Empty states are honest.** The LMS returns `null` rather than `0` for ungraded schools and says so in the UI. This discipline is rare and should be a platform-wide invariant.
- **Tenant branding + full ES/EN** are threaded through properly.
- **Comments carry real intent.** Several encode hard-won product decisions with reasons. They are an asset; preserve them through any refactor.

---

## 2. Security findings

### S1 — The AI builder pipeline has no authentication (P0)

`app/api/ai/[...path]/route.ts` forwards **every** GET/POST to the FastAPI service with no auth check. Verified: zero occurrences of `getAuthContextFromRequest`, `requireAdmin`, or a 401 path. Of 30 API routes, the only unauthenticated ones are the auth endpoints themselves (correct), `/api/health` (fine), `/api/debug/second-brain-check` (see S4), and this one.

**Impact:** an unauthenticated caller can drive company discovery, service discovery, dashboard generation, and **publish** — i.e. provision tenants and mutate what customers see. The proxy also strips nothing and forwards `request.text()` verbatim.

**Fix:** require an authenticated admin context before forwarding; treat the AI service as an internal-only network peer (mTLS or shared secret) rather than something reachable by proxy from the public internet.

### S2 — Arbitrary SQL over HTTP (P0)

`lib/bridge-rolplay-app.ts:41` POSTs `JSON.stringify({ sql })` to a remote endpoint that executes it. There are **11** sites building SQL by string interpolation in that file.

The interpolated values are currently sanitised by construction — `cid` passes through `Math.trunc()`, and `categoryClause()` takes its value from a fixed lookup map, not user input. **So there is no live injection I can demonstrate.** The problem is architectural: the safety rests on every future caller remembering these conventions, and the remote endpoint is a general-purpose SQL executor. If that endpoint is reachable without strong auth, it is full database compromise, independent of this repo's care.

**Fix:** replace the SQL-string transport with a parameterised RPC exposing only the queries the dashboard needs. This is also a prerequisite for the Connector Engine — `discover()`/`metrics()` cannot be safely generic while the transport is "send me SQL".

### S3 — Tenant credentials stored in plaintext (P1)

`migrations/003_pharma_tenant_config.sql:39` declares `auth_header_value TEXT` with no encryption. Bridge credentials for every onboarded tenant sit in cleartext in Postgres. A read-only DB leak or an over-broad backup is a full multi-tenant credential breach.

**Fix:** envelope encryption (KMS/Vault data key) with the ciphertext in Postgres; decrypt in-process, never log. Required before the credential store in §4.

### S4 — `/api/debug/second-brain-check` is unauthenticated (P1)

A debug probe against a live integration, publicly reachable. Remove it, or put it behind the admin gate.

### S5 — No rate limiting anywhere (P1)

No `rate-limit` dependency and no middleware equivalent. Login and register are unauthenticated by nature and therefore brute-forceable; the AI endpoints trigger expensive LLM and discovery work per call.

---

## 3. The self-service blocker

### A1 — Secrets keyed by env var name (P0 for the vision)

`lib/lms-learnworlds.ts` resolves credentials as `LMS_<TENANT_KEY>_API_URL` etc. So provisioning a tenant's LMS requires **adding environment variables and redeploying**. That is developer intervention, by definition, and it contradicts the core requirement.

It is also actively fragile, and this is evidenced rather than predicted:

- `domainMap()` (`lib/pharma-tenant.ts:238`) documents `dynamic (admin-configured) > env > built-in aliases`. A DB row therefore **overrides** the static domain map.
- Locally there is **no `DATABASE_URL`**, so `listActiveTenants()` fails, is swallowed by `.catch(() => [])`, the env map wins, and the key is literally `apotex` → `LMS_APOTEX_*` resolves → LMS works (verified: 41 users, 299 enrollments, 15 real courses).
- On Render the DB supplies the key, so the prefix becomes `LMS_<DB_KEY>` and `LMS_APOTEX_*` is never read.

Note the asymmetry that made this so hard to see: bridge modules kept working on Render because their URL and auth come **from the DB row itself**, so the key's spelling is irrelevant to them. The LMS was the only module whose credentials are addressed *by name*, so only the LMS broke.

**Fix:** a per-tenant encrypted credential store keyed by `tenant_id`, resolved at runtime. No env vars, no redeploy, and the failure mode disappears rather than being documented.

### A2 — Two sources of truth for tenant config (P0 for the vision)

Tenant config exists as both a static `TENANT_CONFIG` block and a `pharma_tenants` row, reconciled at `lib/pharma-tenant.ts:292` by a **hand-maintained field list** that rebuilds the object from scratch.

Any capability flag not explicitly listed there is silently dropped. This produced two distinct bugs during this session alone:

1. `hasLms`/`hasSimulator` absent from the merge → dropped whenever a DB row existed.
2. `hasLms` **unreachable in principle** for DB-only tenants — no static config to carry a value from, and no `has_lms` column to supply one. The table has `has_certification`, `has_objections`, `has_business_lines`, `has_organization`, `has_top_stats` but **not** `has_lms` or `has_simulator`.

A schema where adding a capability requires edits in three places, and silently no-ops if you miss one, will not survive 1000 tenants.

**Fix:** one source of truth — DB-backed tenant config with a typed, versioned capability document (JSONB + Zod at the boundary). Static blocks become seed data only.

### A3 — No connector interface (P1)

There are four backends and **no shared abstraction**. `app/api/dashboard/overview/route.ts` is an `if/else` over `orgType`, and the same branching is repeated across routes. Adding a data source means editing every route.

This is what caused today's second LMS bug: the LMS gate was nested inside the `orgType === 'pharma'` branch, making it structurally unreachable for every other org type — `rolplayAppAvailableModules()` maps only `COACH`/`SIM`/`SEGMENT` and can never return `'lms'`.

The requested `discover()/health()/capabilities()/schema()/metrics()/…` interface is the correct target. **It cannot be retrofitted safely while S2 stands**, because the current transport's contract is "arbitrary SQL".

### A4 — In-process state defeats horizontal scaling (P1)

`lib/pharma-tenant.ts` holds module-level mutable state: `dynamicTenantsLoadedAt`, `dynamicTenantsPromise`, `previouslyLoadedDynamicKeys`, with a 30s in-process TTL. `invalidateDynamicTenantsCache()` invalidates **only the calling process**.

**Consequences:** with more than one instance, tenant config is inconsistent for up to 30s; an admin write appears applied on one instance and not another; and the required "publishing immediately invalidates caches / notifies clients" is unimplementable — there is no cross-instance channel.

**Fix:** shared cache (Redis) + pub/sub for invalidation. This is a prerequisite for §12 Live Synchronisation, not an optimisation.

---

## 4. Performance

| Finding | Evidence | Impact |
|---|---|---|
| No caching layer | no `redis`/`ioredis` dependency | every request re-fetches upstream |
| Slow work on the request path | `/api/dashboard/lms` measured at **14.2s** application code on cold call | user-visible stall; no queue to move it to |
| No background jobs | no `bullmq` or equivalent | discovery/AI work blocks HTTP |
| Client-side fan-out | `app/journey/page.tsx` issues up to 5 parallel requests | latency = slowest; N× auth/tenant resolution |
| No pagination/streaming at the connector layer | — | "millions of records" not currently supported |

The journey page's fan-out was a deliberate, documented trade (avoid duplicating the `orgType` dispatcher server-side). That trade is correct **today** and becomes wrong the moment the Connector Engine exists — revisit it then, not before.

---

## 5. Observability & testing

- **No OpenTelemetry, no Prometheus client, no tracing.** For a platform whose failure mode is "a tenant's tab is silently missing", this is the single highest-leverage gap after security. Today's bug was invisible precisely because nothing reported *why* a module was absent — I had to add a diagnostic log to find out.
- **108 tests** across ~30 routes and 4 bridges. Coverage is meaningful where it exists (LMS aggregation, journey ordering, tenant merge) but thin overall, and the two bugs found today were both in **untested integration seams**, not in unit logic.
- **No connector health checks**, so an upstream outage is indistinguishable from an unconfigured tenant.

---

## 6. Technical debt register

| ID | Item | Sev | Effort |
|---|---|---|---|
| S1 | AI proxy unauthenticated | P0 | S |
| S2 | SQL-over-HTTP transport | P0 | L |
| A1 | Secrets in env var names | P0 | M |
| A2 | Dual source of truth for tenant config | P0 | M |
| S3 | Plaintext credentials at rest | P1 | M |
| A3 | No connector interface | P1 | L |
| A4 | In-process cache/state | P1 | M |
| S4 | Debug route exposed | P1 | XS |
| S5 | No rate limiting | P1 | S |
| P1 | No Redis / job queue | P1 | M |
| O1 | No tracing/metrics | P1 | M |
| A5 | `orgType` branching duplicated per route | P2 | M |
| T1 | Thin integration-seam coverage | P2 | M |
| D1 | No connector SDK/scaffolding | P2 | M |

---

## 7. Implementation order

Sequenced by dependency, not by ambition. Each step is additive and ships independently.

**Phase A — Stop the bleeding (days)**
1. `S1` auth on the AI proxy · `S4` remove debug route · `S5` rate limiting.
2. `O1` minimal structured logging on every capability decision — *why* a module was included or excluded.

> Do A2 before anything else. It is small, it is pure risk reduction, and it makes every later phase debuggable.

**Phase B — Make self-service possible (weeks)**
3. `S3`+`A1` encrypted per-tenant credential store. Read-through: DB first, env fallback, so existing tenants keep working unchanged.
4. `A2` single typed tenant-config document; add the missing capability columns; static blocks become seed data.
5. `A4` Redis-backed shared cache + pub/sub invalidation.

**Phase C — Connector Engine (weeks)**
6. Define the interface; wrap the four existing bridges behind it **without changing their internals**.
7. `S2` parameterised RPC replacing the SQL-string transport.
8. Collapse the per-route `orgType` branching onto the interface (`A5`).

**Phase D — The engines (the requested feature set)**
9. Schema Discovery → KPI Registry → Widget Recommendation → Layout → Insight.
10. Journey/Progress/Dependency engines — generalising the existing `lib/journey.ts`, which already models order, phases, and subset handling.
11. Versioning → Live Sync (needs A4) → Marketplace.

**Phase E — Production hardening**
12. Queue/workers, streaming, pagination, autoscaling, blue-green, DR.

The requested engines are Phase D deliberately. Building the KPI Registry or Widget Engine before B and C means building them against two sources of truth and an unsafe transport, then rewriting them.

---

## 8. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refactor silently drops a tenant capability | **High** — happened twice this session | Tenant sees an empty dashboard | Contract tests per tenant asserting expected module set; make omission a test failure |
| Credential migration locks a tenant out | Medium | Outage | Read-through with env fallback; never delete env vars until DB path is verified per tenant |
| SQL transport replacement changes numbers | Medium | Loss of trust in the data | Golden-master: capture current outputs per tenant, assert byte-identical before cutover |
| Connector abstraction leaks backend quirks | High | Abstraction fails, ad-hoc branches return | Wrap existing bridges *unchanged* first; only then normalise |
| AI-generated dashboards publish wrong metrics | Medium | Customer-visible incorrect analytics | Mandatory validation step; provenance on every KPI; no auto-publish without human confirm |
| Scope: 19 subsystems at once | **High** | Nothing reaches production quality | Enforce phase gates; A and B are non-negotiable prerequisites |

**The dominant risk is scope.** The single most valuable thing this platform could gain next is not an engine — it is the ability to onboard one tenant end-to-end with no redeploy, proven on Apotex. That is Phases A+B, and it is weeks, not months.

---

## 9. Open questions

1. **The FastAPI AI service is outside this repo.** Its resumability, prompt handling, and auth are unaudited. `app/api/ai/route.ts` and the catch-all are thin proxies. That service needs its own audit before the builder can be called production-ready.
2. **Is the remote SQL executor internet-reachable, and what authenticates it?** This determines whether S2 is "architectural risk" or "active P0 incident". I could not determine it from this repo.
3. **Multi-region / data-residency requirements?** Pharma customers frequently impose them, and it changes the credential-store and deployment design fundamentally.
4. **Who owns published dashboard correctness** — is a human sign-off required before a generated dashboard goes live to a customer?

---

## 10. Verification notes

Everything asserted here was checked, not assumed:

- Auth coverage: enumerated all 30 `route.ts` files for an auth-context call.
- Dependencies: `redis`, `ioredis`, `bullmq`, `rate-limit`, `opentelemetry`, `prom-client` — **all absent** from `package.json`.
- LMS working locally: 41 enrolled users, 299 enrollments, 15 real courses, `avgQuizScore: null` with an honest "no graded assessments" message.
- Env/DB divergence: no `DATABASE_URL` locally; `PHARMA_TENANT_DOMAINS` supplies `apotex:apotex.com`; `domainMap()` documents DB precedence.
- `pharma_tenants` columns confirmed to lack `has_lms` and `has_simulator`.
- Timing figures taken from dev-server logs on this machine — indicative of cold-call cost, **not** production benchmarks.

**Limitations I cannot close from here:** no access to the Render environment, its database, or the FastAPI service. Statements about production behaviour are inferences from code plus the local run, and are labelled as such throughout.
