# Production-Readiness Audit & Implementation Plan

**Date:** 2026-08-18
**Baseline audited:** `56aa26a` (RolPlayAI/rolplay_self_service_dashboard `main`)
**Test baseline:** ai-service pytest **304 passed**. Vitest baseline needs a clean re-run
(the first attempt hit `vitest-pool` worker-start timeouts caused by machine contention,
not by test failures — 20/20 files that *did* start passed).

> Scope note: this audits the **real** current state. The working branch was 10 commits
> behind this repo; several phases were already implemented here and are recorded as DONE
> below rather than re-done.

---

## Verdict summary

| Phase | Area | Verdict |
|---|---|---|
| 2 | Builder mandatory-section mechanism | **Mostly DONE** — 2 real holes |
| 2/12 | Company selector auto-populate | **PARTIAL** |
| 12 | "Nuevo" badge | **MISSING** |
| 4 | Layout freeze (`/d/[slug]`) | **DONE** |
| 4 | Layout freeze (hand-built tenant app) | **MISSING** |
| 5 | Threshold storage + post-build edit | **DONE** (pharma only) |
| 5 | Threshold at build time / displayed / honoured | **PARTIAL — 1 of ~40 call sites honours it** |
| 6 | KPI number + visualization | **MISSING** (2 of ~39 KPIs) |
| 6 | 100%-composition → donut/stacked | **DONE** |
| 7 | KPI info button | **PARTIAL** (19 of ~39; all 9 Cesar cards lack it) |
| 8 | KPI data dictionary | **PARTIAL** (22 rendered KPIs undocumented) |
| 9 | AI token-overflow guard | **DONE** (logging MISSING) |
| 9 | Truncated-data honesty in KPIs | **BUG — see C1** |
| 10 | Spanish localization | pending audit |
| 11 | Notification channel decision | **NOT DECIDABLE — documented** |
| 13/15 | Tenant isolation / auth | pending audit |
| 14 | Redis caching | **DONE**; BullMQ absent (correctly) |

---

## Status log

| Item | State |
|---|---|
| S2 `/api/banco` cross-tenant leak | **FIXED** — `resolveBancoAccess` gate |
| S3 `/api/debug/banco-test` | **FIXED** — admin-gated |
| S4 `/api/health` disclosure | **FIXED** — liveness public, diagnostics admin-only |
| S1 pharma membership check | **FIXED where verifiable** — Sanfer + Apotex; 8 tenants have no roster (see below) |
| S1 banco membership check | **FIXED** — `coach_users` roster via `bancoUserExists` |
| S1 open registration | **OPEN** — the only mitigation for the 8 roster-less tenants |
| C1 Cesar KPI sampling bias | **FIXED** — DB-side aggregate + `deltaScoreSampled` flag |
| C3 pass threshold inconsistency | **FIXED** — one `isPassForTenant` predicate across `bridge-pharma-analytics.ts` |
| Phase 2 `second-brain` maps to no page | **FIXED** — stand-in page via `_assemble_pages` |
| Phase 2 mandatory sections dropped on non-rolplay connectors | **FIXED** — mandatory loop no longer skipped |
| C2 static ratio shown as a trend | OPEN |
| C4 no-criteria tenants still see pass-rate UI | OPEN (partially mitigated: `isPassForTenant` no longer invents 70) |
| C5 frozen-layout reason swallowed by builder UI | OPEN |
| C6 unbounded queries | OPEN |
| S5 banco domains merged | OPEN |
| S6 shared LMS credential fallback | OPEN |
| Phase 6 / 7 / 8 / 10 / 12 | OPEN |
| **rolplay_app_sql: Python readiness_index bias** | **FIXED** — mirrored the TS fix: mastered_users now comes from a dedicated unbounded aggregate, not the bounded delta-score scan |
| **rolplay_app_sql: null-vs-zero collapsing** (`?? 0` on avgScore/passRate) | **FIXED** — Overview tiles, simulator/coach/certification pages, CSV export. Shows "—" for no-data, preserves a genuine 0 |
| **rolplay_app_sql: error swallowed as empty data** on `/kpis`, `/ranking`, `/activities` | **FIXED** — all three now surface `error` from `useApi` as a distinct banner |
| **rolplay_app_sql: zero observability on query failure** | **FIXED** — `remoteSelect` (TS) and `_rolplay_app_sql` (Python) now log before the caller's `.catch(() => [])` swallows the error. Silent-degradation behavior is otherwise unchanged (by design — one bad widget must not 500 the whole dashboard) |
| **rolplay_app_sql: SQL injection in `rolplayAppUserExists`** | **FIXED** — this function decides tenant-membership ACCESS (the S1 check); it escaped a quote via `.replace(/'/g, "''")` rather than whitelisting, and registration's own email regex has no denylist on quote/backslash. Now rejects (denies access) rather than escapes |
| **rolplay_app_sql: `deltaScoreSampled` silently dropped** at `/kpis` | **FIXED** — the bridge computed and returned it, the API route forwarded it, but the page interface never declared it. Now shown as a footer note when the sampling cap is hit |
| **rolplay_app_sql: `rolplayAppClosingDataRows` truncation not flagged** (feeds Commercial Domain / Top Strengths / Top Opportunities / Adoption Movement) | **OPEN** — same class of bug as the two fixed above, lower traffic surfaces. Not yet flagged with a `sampled` boolean |
| **rolplay_app_sql: Reports/Results hard 200-row cap, no "showing N of M" indicator** | OPEN — silent truncation for a &gt;200-session tenant, not a crash |
| **rolplay_app_sql: no UI/server cap on date-range span** | OPEN — a 10-year range risks a 20s bridge timeout per query, degrading to the same silent-empty behavior above (now at least logged) |

### Note: membership checks sit on the request path

Both new checks (`bancoUserExists`, `pharmaMemberExists`) run inside
`resolveOrgType`, which nearly every API request calls. Three properties keep that
safe, and all three are covered by tests:

1. **Fast path preserved** — the cheap domain check runs first, so a non-banco /
   non-pharma user triggers no roster lookup at all.
2. **Bounded** — the banco roster query races a 2 s timeout
   (`BANCO_MEMBER_TIMEOUT_MS`). Found during this work: without it, a missing-DB
   environment stalled ~5 s per call and blew the suite's default test timeout.
   In production that would have been a 5 s stall on every banco request.
3. **Fails open, never cached on failure** — a roster outage must not take a
   whole tenant's dashboard down, and the next request retries.

Only Sanfer/Apotex (roster endpoint) and banco (`coach_users`) are actually
verified; every other pharma tenant passes through unverified by necessity.

---

## SECURITY — fix before anything else

These outrank every cosmetic phase in this document. Four of them leak data across
tenant boundaries or to unauthenticated callers.

### S1. Anyone can self-register into a pharma or banco tenant — **highest severity**
`app/api/auth/register/route.ts:32-122` has no domain allowlist, no invite flow and no
email verification. Pharma tenants resolve on **email domain alone**
(`lib/pharma-tenant.ts:387-399`), as does banco (`lib/org-type.ts:25-31`).

So registering `attacker@sanfer.com.mx` (or any `BANCO_EMAIL_DOMAINS` value) grants that
tenant's full dashboard on first login. **No parameter tampering required.**

Note the asymmetry: `rolplay-app` already gets this right — `lib/bridge-rolplay-app.ts:210-231`
verifies the address exists in `r_user` and states outright that "domain match is NOT
authorization". Pharma and banco have no equivalent membership check.
The `analytics` pipeline is also safe (bridge-resolved `customer_id`).

> **Decision taken:** add a membership check mirroring rolplay-app.
>
> **FEASIBILITY CONSTRAINT — a membership check alone cannot close S1.**
> Verified by inspection: only **2 of ~10 pharma tenants have any members data source**.
> `pharmaDashboardOrganization` (`lib/bridge-pharma-analytics.ts:1148-1170`) relies on the
> `org.members` / `list.members` bridge actions, which exist only where
> `hasOrganization: true` — i.e. **Sanfer and Apotex** (`lib/pharma-tenant.ts:205, 221`).
>
> Weser, Adium, Heineken, M8, Lacoste, Lacoste Asistentes, Chiesi and Labomed expose **no
> roster endpoint at all**, so for those eight tenants there is nothing to check an email
> against. Enforcing "deny if not in members" would lock out 100% of their users;
> failing open leaves S1 wide open for exactly those tenants.
>
> Banco is verifiable — `coach_users.user_email` (`lib/bridge-banco-analytics.ts:6, 121`).
>
> **Therefore the complete fix is necessarily two-part:**
> 1. Membership check where a roster exists (Sanfer, Apotex, banco) — mirrors rolplay-app.
> 2. For the eight roster-less tenants, the only real mitigation available today is
>    **closing open registration** (admin-invite only). No amount of code can verify
>    membership against data that does not exist.
>
> Scope: 37 `resolvePharmaTenant` call sites across 14 route files would move to an
> access-checked variant, following the existing
> `resolveRolplayAppClientId` (pipeline) vs `resolveRolplayAppAccess` (authorization) split.

### S2. `GET /api/banco` — no tenant scoping whatsoever
`app/api/banco/route.ts:32-38` checks only that *a* session exists; it never calls
`resolveOrgType`/`isBancoOrg`. The underlying SQL is scoped by nothing but
`WHERE sr.banco_user_id > 0` (`lib/bridge-banco.ts:172, 218, 230, 256`).

Any authenticated user of **any** tenant receives `totalBancoUsers`, `directorsCount`,
`regionalsCount`, `topPerformers` and 20 `recentSessions` (`route.ts:64-87`).
No frontend code calls this route — it is unreferenced but fully live.

### S3. `GET /api/debug/banco-test` — same class
`app/api/debug/banco-test/route.ts:54-58` requires only a session, then returns banco user
counts, 30-day report counts, three real report ids with scores, and the value of
`BANCO_EMAIL_DOMAINS` (`:99-112`). Its own comment at `:8` says to protect it behind an
admin check "once the issue is resolved" — never done.

### S4. `GET /api/health` — completely unauthenticated
`app/api/health/route.ts:37` takes no `request` argument: no cookie, no secret, no rate
limit. Publicly discloses the **full `BRIDGE_URL`** (`:45`), the **production database
name** via `SELECT DATABASE()` (`:96-103`), presence of `BRIDGE_SECRET`/`DB_HOST`/`DB_USER`/
`DB_NAME` (`:41-49`), and up to 500 chars of raw upstream error body (`:67-92`).

This partially defeats the otherwise-clean secret hygiene noted in S7.

### S5. All banco domains are merged into one dataset
`lib/bridge-banco-analytics.ts:52-60` builds
`cu.user_email LIKE '%@bancoppel.com' OR ... '%@coppel.com'` from a single env var with no
per-request narrowing. If Coppel and BanCoppel are distinct commercial entities, every
banco user sees both.

### S6. Shared LMS credential fallback
`app/api/dashboard/lms/route.ts:43` sets `tenantKey = null` for every non-pharma org type;
`lib/tenant-credentials.ts:163-164` then falls back to shared `LMS_*` env vars. If a bare
`LMS_API_URL`/`LMS_CLIENT_ID` is ever set, every analytics/banco/rolplay-app tenant's LMS tab
renders one single LearnWorlds school. Dormant today (only `LMS_APOTEX_*` is set), not fixed.

### S7. Clean (verified, no action)
No hardcoded credentials in application source (only two test fixtures in
`lib/__tests__/secret-crypto.test.ts`). `.env.local` is git-ignored. No secret is exposed via
`NEXT_PUBLIC_*` — the only such var is the `NEXT_PUBLIC_DEMO_MODE` boolean. DB credentials are
server-only. The Dashboard Builder admin gate is correctly enforced server-side
(`app/dashboard-builder/layout.tsx:9-17`) with an independent API gate
(`app/api/ai/[...path]/route.ts:42-48`); the sidebar link is cosmetic only.

Minor: `app/api/auth/setup/route.ts:33` compares the setup secret with `!==` instead of the
`timingSafeEqual` its sibling `bootstrap-admin/route.ts:19` uses.
Minor: `app/api/ai/route.ts:12,28` accepts a client-asserted `userRole` used only in the LLM
prompt — not a scoping key, but it should not be client-supplied.

### S8. Frontend-supplied identifiers — audited clean
Exhaustive sweep of `app/api/**` for request-supplied client/tenant/customer identifiers:
**no non-admin route trusts one for scoping.** Every dashboard route derives scope from
`ctx.email`/`ctx.customerId` off the signed cookie. `?usecaseIds=` widens use cases *within*
the caller's own tenant only (`customer_id` still enforced in SQL). `/api/dashboard-view/[slug]`
correctly ownership-checks the slug (`route.ts:41-61`).

---

## Critical correctness bugs found

### C1. Cesar KPIs computed from a biased 500-row sample, presented as complete
`lib/bridge-rolplay-app.ts:738-744` selects per-user scores with
`ORDER BY s.user_id, s.date_created ASC LIMIT 500`, while `enrolled`
(`:710-712`) counts **all** users with no limit.

`readinessIndex = 100 * mastered / enrolled` (`:779`) therefore divides a
capped numerator by an uncapped denominator. On a tenant with tens of thousands of
users this silently trends toward 0%. `activationRate`, `deltaScore` and
`masteryDistribution` are affected by the same truncation.

Because rows are ordered by `user_id`, the 500 rows are the **lowest-numbered users**,
not a random sample — so this is a systematic bias, not noise. Nothing in the API
response or the UI marks the value as sampled.

This is precisely the failure Phase 9 forbids ("never return a result that appears
complete when the underlying data was truncated"), located in the KPI layer rather
than the AI layer.

### C2. Static ratio rendered as a period-over-period trend
`app/second-brain/page.tsx:142-145` puts `active_members / total_members * 100`
into the `delta` field. `components/SummaryCard.tsx:79-81` renders `delta` as
`+X%` beside "vs prior period". A membership ratio is displayed as a trend.
`noComparison` is not set.

### C3. Configured pass threshold is honoured in exactly one place
`resolvePassThreshold()` exists and works, but only
`aggregateSaleExercisesRows` (`lib/bridge-pharma-analytics.ts:321-331`) consumes it.
A tenant configured at 80 sees an Overview tile at 80 while its trend chart,
usecase table, business-lines table, drilldown badges, Reports rows and **every
module page** still compute at the hardcoded 70. The whole of `ai-service`
(`preview_fetch.py`, `rolplay_score.py`) is unconditionally 70.

`lib/bridge-rolplay-app.ts:249` carries the comment
`// platform-wide pass convention (matches every tenant)` — that comment is now false.

### C4. No-criteria tenants still see pass-rate UI
Only the Overview *tile* is hidden. Still rendered for a no-criteria tenant:
the Score Trend chart's `goal={70}` pass line (`DashboardContent.tsx:764`),
`passFailTrend` (still computed and consumed by `/certification` and Robin AI),
module-page Pass Rate tiles showing a hard **0%**
(`app/{certification,coach,simulator}/page.tsx`), and pass-rate columns in CSV export.

### C5. Frozen-layout rejection is silently swallowed by the builder UI
`ai-service/app/routes/ai.py:183` returns HTTP **200** with
`{"published": false, "reason": "layout_frozen…"}`. `app/dashboard-builder/page.tsx:248-263`
only sets an error when `!res.ok`, so the reason is discarded and the Publish button
just fails to toggle with no explanation. There is no `force_republish` affordance in the UI.

### C6. Unbounded queries
- `lib/db-users.ts:143-147` — `listUsers`: no LIMIT, no pagination, whole `users` table.
- `lib/bridge-banco.ts:108-110` — whole `banco_users` table.
- `lib/bridge-client.ts:462-469` — full-history scan, no LIMIT/date bound; its
  `GROUP_CONCAT` also silently truncates at MySQL's default `group_concat_max_len` 1024.
- `lib/bridge-client.ts:492-497` — unbounded `IN (...)` fed by the above.

All rolplay-app calls have a 20 s `AbortSignal.timeout` and every call site does
`.catch(() => [])`, so an unbounded scan surfaces as **zeros, not an error**.

---

## Phase-by-phase gaps

### Phase 2 / 12 — Builder
- **Selector source:** `ai-service/app/routes/ai.py:45-68` reads `r_client` on the
  rolplay-app DB only. It is a `<datalist>` suggestion list over a free-text input
  (`app/dashboard-builder/page.tsx:328-339`), so free text is always accepted.
- **New clients:** nothing in this repo ever writes `r_client`. Clients onboarded via
  the admin wizard (`pharma_tenants`) or user invites therefore never appear and must
  be typed manually.
- **"Nuevo" badge:** absent. The endpoint returns only `id/name/sessions/users` — no
  timestamp. **Open question:** it is unverified whether `r_client` has a
  creation-timestamp column; only `ID` and `name` are referenced anywhere in the
  codebase, and `ROLPLAY_APP_SQL_URL` is not set locally. Do **not** guess a column
  name — probe the schema at runtime and degrade gracefully.
- **Mandatory sections — hole 1:** `second-brain` is selectable in the UI but maps to
  no page (`dashboard_planning.py:50-53`, `:422`), so selecting it has no effect.
- **Mandatory sections — hole 2:** `_module_pages` returns `[]` at
  `dashboard_planning.py:442-444` for any non-`rolplay_app_sql` primary, **before** the
  mandatory-missing loop at `:477`. A contracted-but-empty Simulator/Coach/Certification
  section is therefore silently dropped for pharma/exceltis/coach_app tenants.
- **Stale contract comment:** `ai-service/app/models.py:381-385` still documents the old
  "contracted ∩ has-data" rule the code no longer implements.

### Phase 4 — Layout freeze
- Works for `/d/[slug]`: render reads stored JSONB config, no re-planning
  (`ai-service/app/routes/ai.py:188-197`, `agents/preview.py:15-18`).
- Reuses the existing `published` boolean — there is no distinct `frozen` state, no
  unfreeze path, and `dashboard_metadata` is created ad hoc in `db.py:44-50` rather
  than by a numbered migration.
- `set_required_sections` (`dashboard_versions.py:128-132`) mutates a frozen layout
  **without** the freeze gate, a version bump, or an audit snapshot.
- **The hand-built tenant app has no freeze at all.** `Sidebar.tsx:77-78,121-159`
  recomputes nav live from `useAvailableModules()` →
  `rolplayAppAvailableModules` → `GROUP BY sim.category` filtered to `n > 0`. New or
  lapsed session categories add/remove sidebar entries on their own.

### Phase 6 / 7 / 8 — KPIs
- Only 2 KPIs have any visualization: Activation Rate (goal bar, and only because
  `goal` is passed at the single call site `app/kpis/page.tsx:121`) and Mastery
  Distribution (donut). ~37 others are bare numbers.
- 100%-composition rule is already respected — no complementary-bars violation exists.
  (`ModuleBarChart` / DashboardRenderer grouped bars are subset-not-complement, so legal.)
- Info button is `Info`, not an eye, and is wired only into `MetricCard`/`SummaryCard`.
  **All 9 Cesar cards, all Second Brain tiles, and every AI-generated tile lack it.**
- `KpiInfoButton` takes one opaque `definition` string; **12 of 19** carry no formula.
- Tap target is 14×14 px (`KpiInfoButton.tsx:90-101`) — under the 24 px WCAG 2.2 minimum.
- Narrow-viewport clamp bug at `:59-62` can push the popover off-screen below 256 px.
- Dictionary covers 11 KPIs; **22 rendered KPIs are undocumented**, including
  Top Strengths / Top Opportunities which live on `/kpis` itself.
- Hardcoded English leaks: `KpiInfoButton.tsx:93` aria-label,
  `DashboardRenderer.tsx:162` `'vs prior period'`/`'no comparison'`,
  `charts/DonutChart.tsx:44` `{value} evaluations`.
- **Good:** non-computable KPIs are handled honestly throughout (nulls → em dash,
  documented reasons at `bridge-rolplay-app.ts:655-670`, never fabricated zeros).

### Phase 9 — AI overflow
- Guard is real: `MAX_INPUT_CHARS = 400_000` (`lib/ai.ts:169`, checked `:189`),
  refuses via `ContextOverflowError`, catches Gemini 400 context errors
  (`:173-179, 218`), catches output-side `MAX_TOKENS` (`:238, 308-310`), EN/ES message
  (`:261-264`). No silent truncation anywhere.
- **Logging MISSING:** the overflow path *returns* rather than throws, so it never
  reaches `console.error` in `app/api/ai/route.ts:39`. Zero observability.
- `buildContext()` sends ~10 scalar lines, so the guard is effectively unreachable from
  the current UI — the real large-data risk is C1, not the prompt.
- `app/api/ai/route.ts:12` accepts an arbitrary client-supplied `context` string with no
  length validation of its own (the guard catches it, but the route doesn't bound it).
- `app/api/ai/route.ts:45-46` returns the raw upstream error message to the client,
  which for a Gemini 400 can echo back a request-body excerpt.

### Phase 11 — Notification channel: **cannot be decided from this codebase**
- No ranking-notification trigger exists anywhere (zero matches for rank+notify).
- No outbound messaging library in `package.json` (no twilio/nodemailer/sendgrid).
- WhatsApp appears **only as read-only analytics** — `lib/second-brain-api.ts` is
  GET-only against Second Brain's own API; the dashboard reads message/broadcast
  counts, it cannot send.
- **No cost data of any kind exists in the repo.**

Per the brief's own instruction, this is documented as a limitation rather than
answered with invented figures. Deciding SMS vs WhatsApp requires carrier/BSP pricing
and expected ranking-event volume, neither of which this system holds.

### Phase 14 — Performance
- Redis is real: `ioredis` + `lib/cache.ts` (lazy connect, 2 s timeout, degrades to an
  in-process Map). Mirrored in `ai-service/app/cache.py`. TTL 60 s on rolplay-app
  queries and the LMS aggregation.
- No BullMQ. `ai-service/app/jobs.py` is an in-process dict-based job manager with
  Postgres write-through — durable across restart, but no workers/retry/backoff/
  distribution. Introducing BullMQ is **not** justified by current evidence.
- Rate limiting is still in-process only (`lib/rate-limit.ts:11-14`), which is a real
  gap on multi-instance deploys.
- Most rolplay-app queries are properly DB-side aggregations. The exceptions are the
  two deliberate `LIMIT 500` raw-row pulls (C1) and the unbounded queries in C6.

---

## Implementation order

Ordered by (correctness risk × blast radius), not by phase number.

1. **C1** — sampling bias in Cesar KPIs. Wrong numbers shown as fact. Fix by moving the
   aggregation DB-side, or by scoping the denominator to the sampled cohort and
   labelling the result as sampled. Must not fabricate.
2. **C3** — thread `resolvePassThreshold` through every pass computation in both
   runtimes; delete the false "matches every tenant" comment.
3. **C4** — honour `hasNoPassingCriteria` across charts, module pages, trends, CSV.
4. **Phase 2 holes** — `second-brain` page mapping; mandatory sections for
   non-rolplay_app_sql primaries.
5. **Phase 12** — runtime schema probe for a `r_client` timestamp → `Nuevo` badge;
   union the selector with tenants onboarded outside `r_client`.
6. **C5** — surface the frozen-layout reason in the builder UI.
7. **Phase 7** — info button on the Cesar cards + AI tiles; split definition/formula/
   meaning; fix the 14 px tap target.
8. **Phase 6** — add visualizations alongside (never replacing) the numeric values.
9. **Phase 10** — localization sweep.
10. **C2, C6, overflow logging** — smaller correctness/robustness fixes.
11. **Phase 8** — extend the dictionary to the 22 undocumented KPIs.

### Guardrails for all of the above
- Do not remove or swap any existing connector.
- Do not replace a real integration with mock data.
- Never fabricate a value to fill a gap — prefer an honest empty/not-available state.
- Re-run `pytest` (304 baseline) and vitest after each change.
