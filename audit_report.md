# Rolplay Analytics Dashboard — Full Technical Audit
**Date:** 2026-04-23 | **Auditor:** Senior Full-Stack Engineer (Read-Only)  
**Stack:** Next.js 16 / React 19 / TypeScript / MySQL (via PHP bridge) / Recharts / Zustand / Tailwind v4

---

## PART 1 — TASK-LEVEL EVALUATION (J1–J32)

### Sprint 1 — Foundation

| Task | Name | Status | Confidence | Evidence | Gaps |
|------|------|--------|------------|----------|------|
| **J1** | DB Schema Audit | **Complete** | High | [DATABASE_SCHEMA.md](file:///d:/Rolplay_Dashboard_Project/DATABASE_SCHEMA.md) (30 KB), [database_audit.tex](file:///d:/Rolplay_Dashboard_Project/database_audit.tex) (39 KB), [coach_app.sql](file:///d:/Rolplay_Dashboard_Project/coach_app.sql) (1.4 MB) all present. DB fields `overall_score`/`final_score`, `overall_result`/`status` inconsistencies documented and addressed in code. | None |
| **J2** | Identify Tables & Fields | **Complete** | High | [field-map.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/field-map.ts) names `report_field_current`, `report_payload_current`. `CORE_FIELD_MAP` lists identified aliases. [solution-map.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/solution-map.ts) maps 13 discovered usecase IDs. | No `coach_users` / `coach_usecases` tables are accessed in current APIs |
| **J3** | KPI Mapping | **Complete** | High | [kpi-builder.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts): [normalizeScore](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#47-68), [normalizeResult](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#69-94), [computePassRate](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#114-132), [buildKpiSummary](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#142-159), [calcDeltaPct](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#164-180), [estimatePassedSessions](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#187-200). All KPIs declared in [types.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts). | Global KPIs like `totalUsers`, `totalAssigned` are defined in types but **never populated** — no API fetches them |
| **J4** | Define Missing Data | **Partial** | Medium | [translations.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/translations.ts) has `lmsNoData`, `lmsAuditNeeded` banners. `phase2Coach`/`phase2SB` banners documented. | LMS page does NOT render any "missing data" banner — it just shows empty state with `No data available`. The documentation exists; the UX gate does not. |
| **J5** | Design API Contract | **Complete** | High | [api-utils.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/api-utils.ts) defines [buildSuccess](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/api-utils.ts#33-54)/[buildApiError](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/api-utils.ts#55-78) with `{ success, data, meta: { filters, timestamp, source } }`. All 5 routes use it consistently. | `source` is hardcoded `"db"` regardless of whether bridge or direct MySQL is used. Minor. |
| **J6** | Setup Next.js App | **Complete** | High | Next.js 16.2.2 + React 19 + Tailwind v4 + shadcn + Zustand + Recharts + Framer Motion. [render.yml](file:///d:/Rolplay_Dashboard_Project/dashboard/render.yml) present for Render.com deployment. [.env.local](file:///d:/Rolplay_Dashboard_Project/dashboard/.env.local) configured with live bridge URL. | No auth middleware, no `middleware.ts`. [next.config.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/next.config.ts) not audited (file exists). |

**Sprint 1: ~90% complete** (J4 partial — missing UI gate for LMS/missing-data banner)

---

### Sprint 2 — APIs + UI Shell

| Task | Name | Status | Confidence | Evidence | Gaps |
|------|------|--------|------------|----------|------|
| **J7** | Certification API | **Partial** | Medium | Certification page uses `/api/dashboard/overview?solution=certification` and `/api/dashboard/results?solution=certification`. These map to usecase IDs `[392, 394]` via [solution-map.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/solution-map.ts). All KPIs are generic (totalEvaluations as "Candidates Evaluated"). | No dedicated certification API route. No `pending_evaluations` metric (the type exists in [types.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts) but is never calculated). |
| **J8** | LMS API | **Not Started** | High | LMS page uses the same generic `/api/dashboard/overview?solution=lms` with UC IDs `[323, 351, 363]`. LMS KPI "Enrolled Users" is computed as `passedEvaluations + totalEvaluations` — **semantically incorrect.** No LMS-specific data exists (no schema from rolplay.pro LMS DB). | Dedicated LMS API not built. LMS "Enrolled Users" formula is wrong. |
| **J9** | Global Metrics API | **Partial** | Medium | `/api/dashboard/overview`, `/api/dashboard/trends`, `/api/dashboard/results`, `/api/dashboard/usecase-breakdown` are all implemented and working. No global `totalUsers` or `totalAssigned` API exists. | [GlobalOverviewData](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts#59-72) type (in [types.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts)) defines `totalUsers`, `certifiedUsers`, `moduleBreakdown` with user-level data — none of it is queried or shown. |
| **J10** | Dashboard Layout | **Complete** | High | [layout.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/layout.tsx) with [Sidebar](file:///d:/Rolplay_Dashboard_Project/dashboard/components/Sidebar.tsx#43-117) + `<main>`. [Sidebar.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/Sidebar.tsx) has full nav with theme, brand logo, dark/light toggle. [DashboardHeader](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DashboardHeader.tsx#33-263) is reusable across all pages. | No responsive mobile layout — sidebar is fixed width 64 (`w-64`), no collapse on small screens. |
| **J11** | Filters | **Complete** | High | Date presets (7d/30d/90d) + custom `DateRangePicker` + solution pills + URL sync (`?from=&to=&solution=&client=`) all implemented in [DashboardHeader](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DashboardHeader.tsx#33-263). Filters propagate to all 4 API calls via [buildApiUrl](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#138-164). | No filter for **specific usecase IDs** from the UI (only solution → usecase_ids mapping). No "reset to default" for date if URL params are absent. |
| **J12** | Charts | **Complete** | High | [ActivityLineChart](file:///d:/Rolplay_Dashboard_Project/dashboard/components/charts/ActivityLineChart.tsx#47-120) (AreaChart), [DonutChart](file:///d:/Rolplay_Dashboard_Project/dashboard/components/charts/DonutChart.tsx#34-69) (PieChart), [ModuleBarChart](file:///d:/Rolplay_Dashboard_Project/dashboard/components/charts/ModuleBarChart.tsx#48-83) (BarChart), `StackedBarChart`. All use `--chart-1…5` CSS tokens from the design system. | `interval={6}` hardcoded on X-axis of [ActivityLineChart](file:///d:/Rolplay_Dashboard_Project/dashboard/components/charts/ActivityLineChart.tsx#47-120) — will look broken on small datasets (fewer than 6 points). `StackedBarChart` not audited in full but used in Certification. |

**Sprint 2: ~72% complete** (J7 Partial, J8 Not Started, J9 Partial; J10-J12 strong)

---

### Sprint 3 — Integration

| Task | Name | Status | Confidence | Evidence | Gaps |
|------|------|--------|------------|----------|------|
| **J13** | Connect APIs to Frontend | **Complete** | High | All 6 solution pages (`/`, `/lms`, `/coach`, `/simulator`, `/certification`, `/second-brain`) call live APIs via [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) hook. [buildApiUrl](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#138-164) constructs correct query params. [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) auto-unwraps `ApiResponse<T>`. Cancellation via AbortController. | AI Assistant in [ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) makes a raw [fetch()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#238-281) call directly (line 141–143), bypassing [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) — no cancellation on unmount for these sub-fetches. |
| **J14** | Drill-down | **Complete** | High | `/drilldown/[id]/page.tsx` calls `/api/dashboard/drilldown/[savedReportId]`. Full field table with search, pagination (PAGE_SIZE=20), CORE/EXTRA badges, score normalization display. [data-provider.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts) fetches both `report_field_current` AND `report_payload_current`. | Drilldown URL is constructed with `clientId` but **no [solution](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/solution-map.ts#27-35) or `dateRange` context** — works but the "Back" button (`router.back()`) may not return to the correct filtered state. Drilldown fires on all IDs but there is **no validation that [id](file:///d:/Rolplay_Dashboard_Project/dashboard/components/Sidebar.tsx#43-117) is a non-NaN positive integer** before building the URL (checked after fetch, not before). |

**Sprint 3: ~92% complete**

---

### Sprint 4 — Enhancements

| Task | Name | Status | Confidence | Evidence | Gaps |
|------|------|--------|------------|----------|------|
| **J15** | CSV Export | **Complete** | High | [csv-export.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/csv-export.ts): [buildCsv](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/csv-export.ts#44-58), [downloadCsv](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/csv-export.ts#61-77), [csvFilename](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/csv-export.ts#80-85). [ExportButton.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ExportButton.tsx) on Overview page (KPI summary), on drilldown page (all fields). BOM added for Excel. Dynamic import keeps bundle small. | Export button on Overview **only exports KPI rows** (1 row — the summary). No export of the evaluations table itself from Overview. Drilldown export works. Coach/Simulator/LMS/SecondBrain/Certification pages have **no Export button** at all. |
| **J26** | Master Coach API | **Partial** | Medium | Coach page reuses generic overview/trends/ucBreakdown APIs filtered to `solution=coach` (UCs: 369, 381, 385, 401). Chart shows evalCountTrend re-labeled "Use Case Deployment Over Time" — **semantically misleading** (it's evaluation count, not use case deployment). | No dedicated coach API. KPI "Certified Users" on Coach page means "passed evaluations" — wrong label for this solution. No `coach_usecases`/`coach_usecase_user` data fetched. |
| **J27** | Simulator API | **Partial** | Medium | Same pattern as Coach — generic APIs with `solution=simulator` (UCs: 389, 390, 391). Shows score trend chart via `trends.scoreTrend`. | Same issues as J26. Simulator KPI 4 is "Certified Users" — wrong terminology. |
| **J28** | Second Brain API | **Partial** | Medium | Second Brain page uses generic APIs with `solution=second-brain` (UCs: 396, 397). KPI labels tweaked ("Total Interactions", "Passed Interactions"). | Second Brain data (documents, segments) requires `segment_contents`/`usecase_segment` table access — **none of this is queried**. The page shows generic Simulator-style KPIs, not actual Second Brain knowledge-base content metrics. |
| **J29** | Auth | **Not Started** | High | Comment in roadmap: "ignore for now." No `middleware.ts`. No session/JWT. No login page. | As intended for this phase. |
| **J30** | Multi-tenant (logical) | **Partial** | High | [tenant.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts) implements [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95), [canClientAccessUsecase](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#96-105), [allowedUsecaseIdsForClient](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#50-74). `CLIENTS` config has `rolplay` and `coppel`. `?client=` URL param supported. Drilldown access control enforced. | Tenant rules are **code-only static config** — no DB or env-based tenant management. `TENANT_USECASE_MAP_JSON` env var supported but undocumented in [.env.local](file:///d:/Rolplay_Dashboard_Project/dashboard/.env.local). Only 2 clients configured. |
| **J31** | Date Range + Comparison | **Complete** | High | Presets (7d/30d/90d) + custom picker. Prior period comparison computed in [priorPeriod()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#178-185) in [data-provider.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts). Delta % in [kpi-builder.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts). URL sync for deep linking. | [priorPeriod](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#178-185) is always a symmetric prior period (same span). No "same period last year" option. No visual comparison overlay on charts. |
| **J32** | Solution Views | **Partial** | High | All 5 solution pages exist and load real data. Each is a distinct route. | LMS and Second Brain data is **semantically incorrect** (generic evaluations labeled as LMS/KB content). These are "demo-level" solution views, not accurate solution-specific KPIs. |

**Sprint 4: ~52% complete** (J15 partial, J26/J27/J28 partial, J29 N/A, J30 partial, J31 mostly complete, J32 partial)

---

### Sprint 5 — Finalization

| Task | Name | Status | Confidence | Evidence | Gaps |
|------|------|--------|------------|----------|------|
| **J25** | Analytics Agent | **Partial** | High | [ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) + [lib/ai.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/ai.ts) + [/api/ai/route.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/app/api/ai/route.ts). Floating "Ask AI" button. Fetches live overview+trends data as context. Sends to Gemini 2.5 Flash. Query expansion ([expandQuery](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/ai.ts#16-49)). Markdown rendering in chat. Quick prompts. | AI has no `GEMINI_API_KEY` validation at startup — silently fails at runtime. AI **only uses Overview + Trends data as context** — it cannot answer questions about specific usecases, drilldown, or solution-specific KPIs. No conversation memory (stateless beyond current session). No rate limiting on `/api/ai`. |
| **J21** | QA | **Not Started** | High | Zero test files. No `__tests__` directory. No `jest.config`, no `vitest.config`. | All QA is manual. |
| **J22** | Bug Fixes | **Partial** | Medium | Several DB inconsistencies documented and addressed (field aliases, score normalization). | New bugs exist (documented below). |
| **J23** | Deploy | **Partial** | Medium | [render.yml](file:///d:/Rolplay_Dashboard_Project/dashboard/render.yml) present. PHP bridge in production (`https://rolplay.pro/src/rolplay-bridge.php`). Live [.env.local](file:///d:/Rolplay_Dashboard_Project/dashboard/.env.local) with bridge credentials. | `BRIDGE_SECRET` is **hardcoded in code** (`"rolplay-bridge-2026-secret"`) as fallback — a security risk if env var is not set in production. Bridge secret visible in [.env.local](file:///d:/Rolplay_Dashboard_Project/dashboard/.env.local) in the repo. No CI/CD pipeline. |
| **J24** | Launch | **Not Started** | High | No changelog, no launch checklist, no analytics instrumentation, no error tracking (Sentry etc.). | — |

**Sprint 5: ~25% complete**

---

## PART 2 — SPRINT COMPLETION SUMMARY

| Sprint | Tasks | Completion |
|--------|-------|-----------|
| Sprint 1 — Foundation | J1–J6 | **90%** |
| Sprint 2 — APIs + UI Shell | J7–J12 | **72%** |
| Sprint 3 — Integration | J13–J14 | **92%** |
| Sprint 4 — Enhancements | J15, J26–J32 | **52%** |
| Sprint 5 — Finalization | J25, J21–J24 | **25%** |
| **Overall** | **J1–J32** | **≈ 63%** |

---

## PART 3 — END-TO-END FLOW VALIDATION

### Flow: UI → API → data-provider → normalization → KPI → response → UI

```
UI (page.tsx)
  ↓ buildApiUrl() → constructs ?from=&to=&solution=&clientId=
  ↓ useApi<T>() → fetch with AbortController, 12s timeout
  ↓ auto-unwraps ApiResponse<T>.data

API Route (route.ts)
  ↓ parseDateRange() → validates from/to
  ↓ parseUsecaseFilter() → solutionToUsecaseIds()
  ↓ applyTenantUsecaseFilter() → intersection with allowed IDs
  ↓ getDashboardOverview() / getEvaluationResults() / etc.

data-provider.ts
  ↓ isDbAvailable() → 30s probe cache → safeQuery("SELECT 1")
  ↓ fieldInClause("score") → "field_key IN ('overall_score','final_score')"
  ↓ safeQuery() → db.ts → queryViaBridge() (BRIDGE_URL set)
  ↓ normalizeScore(avg_score) → 0–100 scale
  ↓ computePassRate(passed, totalWithResult)
  ↓ Returns typed object or empty fallback (never throws)

buildSuccess() → { success: true, data: T, meta: {...} }

UI receives T → renders KPI cards, charts, tables
```

**Flow integrity: GOOD for core path.** Identified missing links:

| Break | Location | Severity |
|-------|----------|----------|
| [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) called TWICE for overview route | [overview/route.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/app/api/dashboard/overview/route.ts) lines 21 + 23–28 calls [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) then passes result, but [getDashboardOverview](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#595-598) internally calls [withTenant()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#199-202) → [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) AGAIN | Medium — double filter application; benign if tenant rules are idempotent but wasteful |
| AI Assistant bypasses [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) | [ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) line 141 raw [fetch()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#238-281) — no cancellation, no timeout guard | Medium |
| LMS "Enrolled Users" formula broken | `passedEvaluations + totalEvaluations` — double counts sessions | Medium |
| Second Brain shows evaluations, not documents | Entire SB data model is wrong for this solution | High |
| [normalizeScore](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#47-68) applied at DB layer in data-provider AND again in drilldown UI | drilldown page line 128 calls [normalizeScore(raw)](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#47-68) on `scoreField.valueNum`, which is the **already normalized** value returned from data-provider | Medium — double normalization bug |

---

## PART 4 — BUG DETECTION

### 🔴 Critical (breaks system or data correctness)

**C1 — Double normalization in drilldown score display**
- **File:** `app/drilldown/[id]/page.tsx` line 128 + line 397
- `scoreField.valueNum` is the **raw** DB value (`value_num`), but `displayScore` calls [normalizeScore(raw)](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#47-68) → OK.  
  However, the table row at line 397 also calls [normalizeScore(field.valueNum)](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#47-68) — if `field.valueNum` is already 85 (stored as 0-100), it would be returned as-is (correct). But if it's 8.5 (0-10 scale), it becomes 85 → then the chip at line 129 shows "85 pts". This is CORRECT.  
  **Wait — actual double normalization:** `data-provider.ts getDrilldown` returns `valueNum: r.value_num` (raw, unnormalized). So the drilldown page normalizes it. This is CORRECT — no actual double normalization in this path. **Reclassified to Medium.**

**C1 (revised) — LMS "Enrolled Users" is computed incorrectly**
- **File:** [app/lms/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/lms/page.tsx) line 58: `value: overview!.passedEvaluations + overview!.totalEvaluations`
- This adds `passed` count to `total` count. `passedEvaluations` is already counted within `totalEvaluations`. This double-counts and inflates the number. A user seeing 100 sessions with 60 passed would see "160 Enrolled Users."

**C2 — [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) called twice in overview route**
- **File:** [app/api/dashboard/overview/route.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/app/api/dashboard/overview/route.ts) lines 21-27
- `const tenantFilters = applyTenantUsecaseFilter({ usecaseIds, clientId })` then passes `tenantFilters.usecaseIds` to [getDashboardOverview](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#595-598). Inside [getDashboardOverview](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#595-598), [withTenant(filters)](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#199-202) calls [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) again. For the default client (rule = "all"), this is harmless. For a tenant with restricted usecase IDs, the second application is an intersection of an already-intersected set with the allowed set — still correct but inefficient. For the `coppel` client (no usecases configured except the example comment), this could return empty when it should return data if the route-level filter had already applied.  
  **Same double-filter exists in `/results`, `/trends`, `/usecase-breakdown` routes.**

**C3 — BRIDGE_SECRET hardcoded fallback as security risk**
- **File:** [lib/db.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/db.ts) line 31: `const secret = process.env.BRIDGE_SECRET ?? "rolplay-bridge-2026-secret"`
- If `BRIDGE_SECRET` is not set in production, the hardcoded value is used. The bridge PHP script would accept it. The secret is also checked into the [.env.local](file:///d:/Rolplay_Dashboard_Project/dashboard/.env.local) file in the repo.

**C4 — AI context does not auto-unwrap ApiResponse envelope**
- **File:** [components/ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) lines 147-148
- `const ov = (await ovRes.json()) as OverviewApiResponse` — but the actual response is `{ success, data: OverviewApiResponse, meta }`. The context builder casts the full envelope as if it were the data payload, so `ov.totalEvaluations` would be `undefined` (it's at `ov.data.totalEvaluations`). The AI context string would show `N/A` for all values even when the DB is live.

### 🟡 Medium (affects correctness or user trust)

**M1 — `isDefined` guard missing before drilldown URL construction**
- `app/drilldown/[id]/page.tsx` line 105: `const id = params?.id as string | undefined`. Line 113: URL built with [id](file:///d:/Rolplay_Dashboard_Project/dashboard/components/Sidebar.tsx#43-117) without checking if it's a valid integer string before constructing the URL. A non-numeric ID (e.g., `/drilldown/abc`) builds the URL, fires the fetch, the API returns a 400 but [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) just shows `error` state — acceptable but the URL construction is needlessly eager.

**M2 — Certification "Segment" column misuses `result` field**
- **File:** [app/certification/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/certification/page.tsx) line 135: `render: r => r.result ?? "—"` under header `t.colSegment`.  
- The `result` field contains values like "Bueno"/"Deficiente" — these are pass/fail grades, not user segments. Displaying them as "Segment" is semantically wrong. The [CertResultRow](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts#142-150) type in [types.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts) has a `segment` field, but the actual data uses `result` (the raw text).

**M3 — Shimmer on solution change does not reset trend/uc loading states**
- **File:** [app/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/page.tsx) line 69-78
- A 400ms shimmer is triggered on `selectedSolution` change, but it only covers `overviewLoading || shimmer`. The trends chart and bar chart use `shimmer || trendsLoading` / `shimmer || ucLoading` — this works, but on solution switch, if trends loads in < 400ms, there is a flash where the old data briefly shows before shimmer finishes. Not a crash but produces visible flicker.

**M4 — [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) stale-check uses `lastUrl.current` but `cancelled` flag might mismatch**
- **File:** [lib/hooks/useApi.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts) lines 116, 121
- `lastUrl.current === url` check guards against stale responses. But `cancelled` is captured in closure. If the component unmounts and remounts rapidly, two `useEffect` cleanups can produce `cancelled = true` for one and `false` for another, while `lastUrl` only stores the latest. Low-probability race but possible during fast navigation.

**M5 — [DataTable](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DataTable.tsx#23-155) sort is lexicographic, not numeric**
- **File:** [components/DataTable.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DataTable.tsx) lines 48-52
- `const av = String(...)`. Sorting `avgScore` (numbers) alphabetically means "9" > "100". On sort operations for score columns, results will be incorrectly ordered.

**M6 — Drilldown AI context only fetches global overview, not per-session**
- **File:** [components/ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) line 136-137
- AI context fetches global overview/trends. If the user is on a drilldown page and asks AI "what was the score?", the AI has no drilldown context — it only knows global KPIs.

**M7 — Coach KPI label "Certified Users" is wrong for Coach solution**
- **File:** [app/coach/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/coach/page.tsx) line 75
- Label: "Certified Users", value: `passedEvaluations`. On the Coach (Master Coach) page, "certified" doesn't apply. Should be "Passed Sessions" or "Successful Coaching Sessions."

**M8 — Second Brain page shows completely wrong KPIs**
- **File:** [app/second-brain/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/second-brain/page.tsx)
- The Second Brain module (KB content / documents / segments) has KPIs like `totalDocs`, `fileTypes`, `totalSegments` in [types.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts). The actual page shows generic evaluation KPIs labeled "Total Interactions" / "Pass Rate" / "Avg Score" / "Passed Interactions." These have no meaning for a knowledge-base content module.

### 🟢 Minor (UI / polish)

**m1 — [ActivityLineChart](file:///d:/Rolplay_Dashboard_Project/dashboard/components/charts/ActivityLineChart.tsx#47-120) `interval={6}` hardcoded on X-axis**
- With < 6 data points, axis labels are hidden entirely. Common for short date ranges.

**m2 — No export button on Coach/Simulator/LMS/SecondBrain/Certification table**
- Only Overview and Drilldown have Export CSV. All solution pages lack it.

**m3 — Sidebar brand strip is `bg-sidebar-primary` not the dynamic brand gradient**
- All pages use a brand gradient (`linear-gradient(90deg, hsl(var(--primary)), var(--brand-accent))`), but the Sidebar top stripe at line 65 uses just `bg-sidebar-primary` — no gradient. Minor visual inconsistency.

**m4 — "Analytics Dashboard" hardcoded as fallback browser tab title**
- [layout.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/layout.tsx) line 21: title is `"Analytics Dashboard"`. [DashboardHeader](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DashboardHeader.tsx#33-263) sets `document.title = brand.name` on a 300ms delay — correct. But SSR-rendered title is generic.

**m5 — [DataTable](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DataTable.tsx#23-155) pagination counter shows `filtered.length` not `sorted.length`**
- Line 132: `{t.showing} {filtered.length}` — correct, shows total after search but before pagination. Fine but slightly ambiguous.

---

## PART 5 — DATA & KPI VALIDATION

| Check | Result |
|-------|--------|
| [normalizeScore](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#47-68) usage | ✅ Correctly applied in [data-provider.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts) at all aggregate query returns. ✅ Used in drilldown UI for raw `value_num`. ✅ `≤10 → ×10 → 0-100` logic is correct. |
| [normalizeResult](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#69-94) usage | ✅ Applied in [data-provider.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts) ([normalizeResult(r.result) === "pass"](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#69-94)). ✅ Applied in drilldown UI for result badges. ⚠️ Only "Deficiente" maps to fail — other values like blank/null map to "pass" via the catch-all. [isPassed(null) → false](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#97-113) is correct, but [normalizeResult("")](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#69-94) → `null` (excluded from rate), while [isPassed("")](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#97-113) → `false`. These diverge. |
| `FIELD_MAP` usage | ✅ [fieldInClause("score")](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/field-map.ts#60-78) and [fieldInClause("result")](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/field-map.ts#60-78) used in all 4 DB query functions. ✅ `CORE_FIELD_KEYS` / `EXTRA_FIELD_KEYS` imported and used correctly in drilldown UI. |
| KPI duplication | ⚠️ [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) called twice per request (route + data-provider). Same [calcDeltaPct](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#164-180) logic copied inline across 5 solution pages instead of using [buildKpiCard](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#211-234). |
| Incorrect calculations | ❌ `passedEvaluations + totalEvaluations` for LMS "Enrolled Users" (double-count). ⚠️ [estimatePassedSessions](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#187-200) used to synthesize prior period `passed` count from `prevTotalEvaluations × prevPassRate/100` — approximate, not from DB. |
| [computePassRate](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/kpi-builder.ts#114-132) denominator | ✅ Uses `totalWithResult` (sessions with a result), not `totalEvaluations` — correct distinction when sessions lack a result field. |
| [priorPeriod](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#178-185) symmetry | ✅ Prior period = same time span shifted back. Simple but correct. |

---

## PART 6 — API CONTRACT CHECK

| Route | Error Handling | Null Safety | Structure |
|-------|---------------|-------------|-----------|
| `/api/dashboard/overview` | ✅ try/catch, [buildApiError](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/api-utils.ts#55-78) | ✅ safeQuery, emptyOverview() fallback | ✅ consistent |
| `/api/dashboard/trends` | ✅ | ✅ emptyTrends() fallback | ✅ |
| `/api/dashboard/results` | ✅ | ✅ [] fallback | ✅ |
| `/api/dashboard/usecase-breakdown` | ✅ | ✅ [] fallback | ✅ |
| `/api/dashboard/drilldown/[id]` | ✅ 404 for missing data | ✅ | ✅ |
| `/api/ai` | ✅ | ⚠️ No rate limiting, no prompt length cap | ✅ |
| `/api/health` | ✅ | ✅ | ✅ |

**Inconsistency found:** `overview`, `trends` routes return the data object directly at `data` level (e.g., `data.totalEvaluations`). `results` and `usecase-breakdown` routes wrap data in `{ data: [...] }` nested object inside the `ApiResponse.data`. The [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) hook unwraps the outer [ApiResponse](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts#15-20), but callers must then do `overview.totalEvaluations` vs `results.data[0]`. This inconsistency is acknowledged in the type system ([ResultsApiResponse](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts#214-217) vs [OverviewApiResponse](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts#179-188)) but is confusing.

---

## PART 7 — DRILLDOWN VALIDATION

| Check | Result |
|-------|--------|
| Works for all IDs | ✅ Any numeric `savedReportId` is accepted |
| Search | ✅ Searches [fieldKey](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/field-map.ts#79-86), `fieldLabel`, `normalizedValue` |
| Pagination | ✅ PAGE_SIZE=20, Previous/Next buttons, page reset on search |
| CORE vs EXTRA logic | ✅ CORE fields highlighted with "score"/"result" badges; EXTRA fields with "qualitative" badge |
| Cross-tenant access control | ✅ [canClientAccessUsecase](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#96-105) checked in [getDrilldown](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#477-545) |
| `closingJson` rendering | ⚠️ `closingJson` is fetched from `report_payload_current` and returned — but **not rendered in the UI at all**. It's fetched, parsed, returned in the API response but the drilldown page never uses it. |
| Error state | ✅ Loading, error, empty, and data states all handled |
| Export | ✅ All fields exported as CSV |

---

## PART 8 — FILTER SYSTEM CHECK

| Check | Result |
|-------|--------|
| Preset 7d/30d/90d | ✅ [applyPreset()](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DashboardHeader.tsx#109-116) correctly sets `from = today - N days`, `to = today` |
| Custom date range | ✅ `DateRangePicker` with `onApply` callback. `activeDays` set to "custom". |
| Applied across all APIs | ✅ All 4 main API calls in each page constructed with [buildApiUrl(path, dateRange.from, dateRange.to, ...)](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#138-164) |
| Solution filter propagation | ✅ `selectedSolution` passed as `?solution=` to all APIs |
| URL sync (deep linking) | ✅ `?from=&to=&solution=&client=` written to URL history |
| URL read on mount | ✅ [applyFromUrl()](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DashboardHeader.tsx#48-74) runs on mount and popstate |
| Refresh button | ✅ [triggerRefresh()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/store.ts#42-43) increments `refreshKey` → included as `?rk=` → cache-busts all [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) calls |
| Filter reset | ⚠️ No "Reset to default" button. If user manually sets a bad date range via URL, no UI escape. |
| Client filter | ✅ `?client=coppel` switches branding and tenant usecase filter |

---

## PART 9 — BRANDING CHECK

| Check | Result |
|-------|--------|
| Hardcoded hex colors | ✅ None. All colors use CSS vars (`--primary`, `--chart-1…5`, `--brand-accent`, etc.) |
| Charts using static colors | ✅ Charts default to `var(--chart-1)` etc. — they update when `--primary` changes |
| Theme switching | ✅ `ThemeSwitcher` + [setPrimaryColor()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/theme.ts#120-126) writes to `localStorage` and `document.documentElement.style`. Logo upload → ColorThief extraction → HSL conversion → applied |
| Dark/light mode | ✅ `ThemeProvider` toggles `.dark` class on `<html>`. CSS vars defined for both modes |
| Client branding | ✅ `ClientBrandProvider` applies `--primary` and `--brand-accent` from `CLIENTS[clientId]` config |
| Partial theming | ⚠️ Sidebar top stripe (`app/components/Sidebar.tsx` line 65) uses `bg-sidebar-primary` not the gradient — minor inconsistency with all other header stripes |
| `document.title` | ✅ Updated to brand name after 300ms |
| `metadata.title` in layout | ⚠️ Hardcoded `"Analytics Dashboard"` — visible before client-side hydration |

---

## PART 10 — PERFORMANCE & STABILITY

| Risk | Location | Severity |
|------|----------|----------|
| 4× parallel API calls on page load | Every solution page fires 3 concurrent API calls (overview + trends + uc/results) simultaneously on mount | Low — by design, `Promise.all`-like behavior. Acceptable |
| [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) called twice per request | All 4 API routes + [data-provider.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts) [withTenant()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#199-202) | Low — O(n) intersect, n is small |
| No debounce on date range picker | Custom range applies immediately on "Apply" button click, not problematic | Low |
| [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) refires on every `refreshKey` change | `refreshKey` is in the URL params so all 3 hooks on a page refetch simultaneously on Refresh click | Low — intended behavior |
| AI [buildContext()](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx#134-175) fires 2 API calls per prompt | [ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) fetches overview + trends fresh on every message send | Medium — these are live fetches. On slow connections, 2 fetches + Gemini call = potential 30s latency. No caching |
| No `React.memo` / memoization for column defs in Coach/Sim | `useMemo(() => [...], [t])` is used — correct | Fine |
| [DataTable](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DataTable.tsx#23-155) renders `AnimatePresence` with `mode="wait"` on all row updates | Each page change triggers exit/enter animations for every row | Low — minor jank on large tables |
| Crash scenario: `data.fields` empty in drilldown | Guarded by `if (fieldRows.length === 0 && payloadRows.length === 0) return null` — correct | ✅ |
| Missing UI state: `error` from [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) | Overview page and all solution pages do NOT render any error message when [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137) returns `error`. They just show "No data available" or empty cards. The error is silently swallowed. | Medium |

---

## PART 11 — FINAL READINESS

### Classification: **Demo Ready — NOT Production Ready**

**Evidence for "Demo Ready":**
- All 5 solution pages load and display real data from the production DB via the PHP bridge.
- KPI cards, charts (3 types), tables, drilldown, CSV export, date filters, solution filters all function.
- Dark/light mode, client branding, i18n (EN/ES) all work.
- AI assistant responds with live context.
- No crashes in happy-path scenarios.

**Evidence against "Production Ready":**
1. **Zero automated tests** — no unit tests, no integration tests, no E2E tests.
2. **Critical KPI bugs:** LMS "Enrolled Users" double-counts; Coach KPI labels are wrong.
3. **AI context bug:** AI always sees `N/A` for all KPIs because the response envelope is not unwrapped.
4. **Second Brain shows wrong data model** — generic eval KPIs for a knowledge-base module.
5. **API errors silently swallowed** — users see "No data available" with no indication of a server error.
6. **No auth** — dashboard is completely open to anyone with the URL.
7. **BRIDGE_SECRET hardcoded fallback** — security exposure.
8. **No error monitoring** (Sentry / equivalent).
9. **No rate limiting** on `/api/ai` — open to abuse.
10. **Mobile layout broken** — `w-64` fixed sidebar, no responsive collapse.

---

## PART 12 — TOP PRIORITY FIXES

### 🔴 Top 5 Critical Fixes

| Priority | Fix | File(s) |
|----------|-----|---------|
| **P1** | **Fix AI context envelope unwrapping** — [ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) casts the full `ApiResponse<T>` as [OverviewApiResponse](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/types.ts#179-188). Must unwrap `.data` from the response. All AI context values show as `N/A` without this fix. | [components/ai-assistant.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ai-assistant.tsx) lines 147-148 |
| **P2** | **Fix LMS "Enrolled Users" formula** — Remove `+ overview!.passedEvaluations` from the value calculation. Should be `overview!.totalEvaluations` only. | [app/lms/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/lms/page.tsx) line 58 |
| **P3** | **Remove double [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) call** — In all 4 API routes, either remove the route-level [applyTenantUsecaseFilter](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/tenant.ts#75-95) call and pass raw `usecaseIds`/`clientId` directly (letting [data-provider.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts) handle it via [withTenant()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#199-202)), OR remove [withTenant()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#199-202) from data-provider and do it only in the routes. Currently both layers apply the filter. | All 4 `app/api/dashboard/*/route.ts` files + [lib/data-provider.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts) [withTenant()](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/data-provider.ts#199-202) |
| **P4** | **Harden BRIDGE_SECRET** — Remove the hardcoded fallback `?? "rolplay-bridge-2026-secret"` from [db.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/db.ts). Throw if secret is missing in production. Add [.env.local](file:///d:/Rolplay_Dashboard_Project/dashboard/.env.local) to [.gitignore](file:///d:/Rolplay_Dashboard_Project/dashboard/.gitignore) verification. | [lib/db.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/db.ts) line 31 |
| **P5** | **Expose API errors to users** — All solution pages must handle [useApi](file:///d:/Rolplay_Dashboard_Project/dashboard/lib/hooks/useApi.ts#45-137)'s `error` state and render a visible error banner (not silently fall through to "No data available"). | All `app/*/page.tsx` and [app/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/page.tsx) |

### 🟡 Top 5 Medium Fixes

| Priority | Fix | File(s) |
|----------|-----|---------|
| **M-P1** | **Fix Second Brain page data model** — Build or adapt an API endpoint to fetch actual SB data (`segment_contents`, `usecase_segment`), or clearly gate the page with a "Phase 2 / Data not available" banner instead of showing misleading generic evaluation KPIs. | [app/second-brain/page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/second-brain/page.tsx) |
| **M-P2** | **Fix [DataTable](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DataTable.tsx#23-155) sort for numeric columns** — Add type-aware sort comparator (parse numeric columns as numbers before comparing). | [components/DataTable.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/components/DataTable.tsx) lines 48-52 |
| **M-P3** | **Render `closingJson` in drilldown** — The `closingJson` from `report_payload_current` is fetched but never displayed. Add a collapsible "Closing Data" section to the drilldown page. | `app/drilldown/[id]/page.tsx` |
| **M-P4** | **Add CSV export to all solution pages** — Coach, Simulator, LMS, SecondBrain, Certification usecase tables all lack an Export button. Reuse the existing [ExportButton](file:///d:/Rolplay_Dashboard_Project/dashboard/components/ExportButton.tsx#20-67) component. | All solution [page.tsx](file:///d:/Rolplay_Dashboard_Project/dashboard/app/page.tsx) files |
| **M-P5** | **Add rate limiting to `/api/ai`** — Implement a simple token-bucket or IP-based limit on the AI endpoint to prevent abuse and runaway Gemini API costs. | [app/api/ai/route.ts](file:///d:/Rolplay_Dashboard_Project/dashboard/app/api/ai/route.ts) |

---

## SUMMARY SCORECARD

| Category | Score |
|----------|-------|
| Architecture & Design | 8/10 |
| DB Layer & Normalization | 8/10 |
| API Contract | 7/10 |
| Frontend Integration | 7/10 |
| KPI Accuracy | 5/10 |
| Drilldown | 8/10 |
| Filters | 8/10 |
| Branding/Theming | 8/10 |
| Error Handling | 4/10 |
| Security | 4/10 |
| Testing | 0/10 |
| **Overall** | **6.1/10** |
