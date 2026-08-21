# KPI Audit & Mapping (internal)

Traces every KPI computed anywhere in the dashboard back to its formula, numerator,
denominator, and underlying source, then records what was found wrong (and fixed),
what was investigated and found correct despite looking unusual, and what could not
be verified from the code/data available and is flagged rather than guessed at.

Scope: `lib/bridge-pharma-analytics.ts`, `lib/bridge-rolplay-app.ts`,
`lib/bridge-client.ts`, `lib/bridge-banco-analytics.ts`, `lib/bridge-banco.ts`,
`lib/kpi-builder.ts`, `ai-service/app/preview_fetch.py`, `ai-service/app/rolplay_score.py`,
`ai-service/app/agents/dashboard_planning.py`, `ai-service/app/lms.py`,
`ai-service/app/journey.py`, `ai-service/app/agents/insights.py`, `ai-service/app/models.py`.

See also `docs/kpi_data_dictionary_v2.csv` (Cesar KPI page only, rolplay_app_sql).
This document is the superset: every module, every connector.

---

## 1. How to read this

Each KPI entry has: name · module · description · formula · numerator · denominator ·
source table/endpoint · source fields · calculation location (`file:line`) ·
default/edge-case behavior · interpretation (including any flag).

Per the audit ground rules: **a formula is only changed when the source data and
intended meaning clearly justify the correction.** Where the correct formula
couldn't be determined from the code/data available, it's flagged, not guessed.

---

## 2. Cross-cutting: pass/score-threshold convention per source

| Source | Threshold | Configurable? | Null/zero handling |
|---|---|---|---|
| `bridge-pharma-analytics.ts` (sale_exercises, exceltis_rest) | `resolvePassThreshold(tenant)` → per-tenant `pass_threshold`, or `LEGACY_PASS_THRESHOLD=70` if never configured, or `null` if `hasNoPassingCriteria` | Yes, per pharma tenant (`pharma_tenants` table, migration `009_pass_threshold.sql`) | `null` (section hidden) when no passing criteria |
| `bridge-pharma-analytics.ts` (Apotex, `kind:'kpi'`) | Externally reported `pass_rate_pct` | N/A — computed upstream, not by us | Opaque — **flagged**, see §5.1 |
| `bridge-rolplay-app.ts` | Hardcoded `PASS_THRESHOLD = 70` | No — no DB column exists yet for rolplay_app_sql tenants (documented gap, not a bug: `lib/bridge-rolplay-app.ts` comment above the constant) | `score != null ? score>=70 : null` |
| `bridge-rolplay-app.ts` Cesar mastery bar | Hardcoded `MASTERY_THRESHOLD = 95`, a **separate, independent** bar from pass/fail | No | Same file |
| `bridge-client.ts` (coach_app_sql) | Delegated to upstream `saved_reports.passed_flag` | No | Denominator scoping — see §5.2 |
| `bridge-banco-analytics.ts` | Hardcoded `60` | No | See §5.3 for the `score_pct > 0` population filter |
| `bridge-banco.ts` | N/A — round-based, no scoring concept | N/A | N/A |
| `ai-service/rolplay_score.py` | Hardcoded `70`, mirrors TS byte-for-byte (deliberately kept in sync, verified identical) | No | `passed` field computed but not currently surfaced by its only caller |
| `ai-service/preview_fetch.py` (rolplay_app_sql, pharma sale_exercises/exceltis_rest) | `cfg.pass_threshold`, same DB-backed value as the TS pharma path | Yes | `None` on zero-scored population |

**Investigated and confirmed NOT a bug**: `LEGACY_PASS_THRESHOLD=70` (`lib/kpi-builder.ts:204`)
vs. `GenerateRequest.pass_threshold` default `80` (`ai-service/app/models.py:427`) looked
like a live inconsistency on first read, but they answer two different questions:
`LEGACY_PASS_THRESHOLD` is the grandfathered value for a pharma tenant that predates the
threshold feature and has no `pass_threshold` column set at all. `80` is a **client-side
form default** shown in the Dashboard Builder's "pick a threshold" input when generating a
*new* dashboard (`app/dashboard-builder/page.tsx:234`, `DEFAULT_NEW_PASS_THRESHOLD` in
`app/admin/tenants/page.tsx`) — the admin always explicitly submits a real value (default
or edited) in `GenerateRequest.pass_threshold`, so this is never actually "unconfigured."
No code change made.

---

## 3. Overview

### Total Evaluations / Sessions
- **Module**: Overview (all connectors)
- **Description**: Count of sessions/evaluations in the selected date range.
- **Formula**: `COUNT(*)` (or `COUNT(DISTINCT saved_report_id)` for coach_app_sql) over the source's own session population.
- **Numerator/Denominator**: N/A — raw count.
- **Source / fields**:
  - pharma sale_exercises: `sim.demorp6` — `lib/bridge-pharma-analytics.ts:342`
  - rolplay_app_sql: `r_user_session s JOIN r_user u`, `COUNT(*)` — `lib/bridge-rolplay-app.ts:437`
  - coach_app_sql: `rolplay_pro_analytics.report_field_current JOIN coach_app.saved_reports`, `COUNT(DISTINCT saved_report_id)` — `lib/bridge-client.ts:149,153`
  - banco-analytics: `saved_reports` with a parseable, non-zero `closingretro` score — `lib/bridge-banco-analytics.ts:148-159`
  - banco.ts: `saved_reports` — `lib/bridge-banco.ts:208-220` (**fixed**, see §4.1)
- **Edge case**: `0` on an empty range, never fabricated.
- **Interpretation**: Sound per-source. Do not compare "total sessions" *across* `bridge-banco-analytics.ts` and `bridge-banco.ts` — they are two structurally different pipelines over different table sets and will not agree for the same tenant/period (flagged, §5.4).

### Average Score
- **Module**: Overview
- **Formula (rolplay_app_sql)**: `ROUND(AVG(SCORE_SQL),2)` — `SCORE_SQL` tries `raw_closing_data.score_bar` → `overall_score` → 4 known HTML-template markers in `closing_analysis`, in order, first match wins. `lib/bridge-rolplay-app.ts:333-353,439`. Byte-identical to `ai-service/app/rolplay_score.py`'s copy (verified).
- **Formula (coach_app_sql)**: `ROUND(AVG(SCORE_CASE),2)`, `SCORE_CASE = value_num<=10 ? value_num*10 : value_num` for `field_key IN ('overall_score','final_score')` — `lib/bridge-client.ts:74-81,150`.
- **Formula (banco-analytics)**: Parses `closingretro` free text (`"Score Global de la Sesion: 7.5/10"` → `(7.5/10)*100`) via `SUBSTRING_INDEX` — `lib/bridge-banco-analytics.ts:91-108`.
- **Denominator**: Non-null/parseable scores only in every source (SQL `AVG` excludes NULL).
- **Edge case**: `null` when nothing scored, at the Overview level, everywhere. **Exception**: `bridge-banco-analytics.ts`'s Trends-level daily average coerces a null day to `0` instead of omitting it/leaving it null — inconsistent with its own Overview behavior. Flagged, not changed (§5.5) — need to confirm the chart consumer treats `0` and "no day" the same way before touching this.
- **Interpretation**: Three independent score-extraction mechanisms exist (JSON/HTML markers for rolplay-app; DB rows for coach_app; free-text HTML parsing for banco). Each is internally consistent with its own source's data shape — not a bug, but they don't share code, which is a drift risk for future changes (no action taken; refactoring three working extractors into one shared helper is out of scope for a correctness audit).

### Pass Rate
- **Module**: Overview
- **Formula (pharma)**: `resolvePassThreshold`-gated; hidden (`null`) if the tenant has no passing criteria.
- **Formula (rolplay_app_sql)**: `passed/scored*100`, `scored = COUNT(SCORE_SQL)` — **correctly excludes unscored sessions from the denominator**. `lib/bridge-rolplay-app.ts:494,436-445`.
- **Formula (coach_app_sql)**: `passed/total_results*100`, where `total_results` is defined identically to "total sessions" (all sessions, not "sessions with a defined result"). `lib/bridge-client.ts:151-153`. **Flagged**, not changed — §5.2.
- **Formula (banco-analytics)**: `100*SUM(score_pct>=60)/NULLIF(COUNT(*),0)`, over a population already restricted to `score_pct>0` (excludes exactly-zero/unparseable rows). `lib/bridge-banco-analytics.ts:148-159`. **Flagged**, not changed — §5.3.

---

## 4. Corrections implemented

### 4.1 `bridge-banco.ts` — total sessions/active users/avg rounds undercounted real sessions

- **KPI(s) affected**: `totalSessions`, `activeBancoUsers`, `avgRoundsPerSession`, and each rep's `sessions`/`avgRounds` in `topPerformers`.
- **Module**: Banco (round-based pipeline, `bridgeBancoKpis`).
- **Root cause**: The summary and top-performers queries used `JOIN (SELECT saved_report_id, COUNT(*) ... GROUP BY saved_report_id) rnd ON rnd.saved_report_id = sr.id` — an **INNER** join. A session with zero rows in `coach_app.saved_reports_options` never appears in that subquery's output at all, so the INNER join silently dropped it from every KPI in that query. Meanwhile the sibling `sessionsByPosition` query (`lib/bridge-banco.ts:224-235`) has no rounds join and counts every session, and `bridgeBancoSessions` (`:143-188`, the recent-sessions list) uses a `LEFT JOIN` + `COUNT(sro.id)` so a zero-round session correctly appears with `rounds_completed:0`. Net effect: for the same tenant and date range, `sessionsByPosition`'s totals could exceed `totalSessions` — a discrepancy with no explanation from the underlying data, exactly the kind of thing this audit was asked to find.
- **Fix**: Changed both queries' `JOIN (...)` to `LEFT JOIN (...)` and wrapped the aggregated `round_count` in `COALESCE(rnd.round_count, 0)`, matching `bridgeBancoSessions`'s existing convention. `totalSessions`/`activeBancoUsers`/a rep's `sessions` now count every real session; `avgRoundsPerSession`/`avgRounds` become a true "rounds per session" average instead of "rounds per session-that-had-any-rounds."
- **Location**: `lib/bridge-banco.ts:207-233` (summary), `:243-265` (top performers).
- **Verified**: `lib/__tests__/bridge-banco.test.ts` (new) — asserts both queries emit `LEFT JOIN (` + `COALESCE(rnd.round_count, 0)` and never a bare `JOIN (` onto the rounds subquery; a manually-calculated example (3 sessions, one with zero rounds: avg = `(2+3+0)/3 = 1.67 → 1.7`) confirms `totalSessions` now agrees with the independently-computed `sessionsByPosition` sum for the same period. Full suite: 622/622 vitest passing after the change; `npx tsc --noEmit` clean.
- **Not changed alongside this**: `bridge-banco.ts`'s `Promise.allSettled` pattern means a genuine DB error on one of the 4 parallel queries renders identically to "tenant has zero real data" (`hasData:false`) — a real resilience/observability gap, but not a formula error, and fixing it would require a UI-visible "partial data" state that's outside a KPI-correctness fix. Flagged for a future ticket, not addressed here.

---

## 5. Flagged — cannot determine from available data, not changed

### 5.1 Apotex (`pharma_kpi`) `pass_rate_pct`
Computed entirely by Apotex's own external bridge; neither `resolvePassThreshold` (TS) nor `cfg.pass_threshold` (Python) has any effect on it, unlike every other pharma connector kind. Cannot verify its formula, whether it's configurable at all, or whether "pass" means the same thing there as everywhere else in this dashboard, from any file in this repo. **Action if this needs resolving**: ask Apotex/the upstream bridge owner directly what `pass_rate_pct` measures.

### 5.2 `coach_app_sql` pass-rate denominator = all sessions
`bridge-client.ts`'s `total_results` (the pass-rate denominator, used in Overview, Usecase Breakdown, and Best Performers) is defined identically to "total sessions" — i.e. it includes any session whose `saved_reports.passed_flag` is `NULL`, not just sessions with a defined result. If `passed_flag` can genuinely be `NULL` upstream (session never got scored/flagged), those sessions are currently counted toward the denominator but not the numerator, silently pulling the rate down as if they failed. **Whether `passed_flag` is ever actually NULL for a real session cannot be determined from this repo** — it depends on how the upstream `coach_app.saved_reports` table is populated. Not changed. **Action if this needs resolving**: query `SELECT COUNT(*) FROM coach_app.saved_reports WHERE passed_flag IS NULL` against a real coach_app_sql tenant; if that's ever non-zero, the fix is to exclude those rows from the denominator the same way rolplay_app_sql already excludes unscored sessions.

### 5.3 `bridge-banco-analytics.ts` excludes `score_pct = 0` from every KPI's population
The `HAVING score_pct IS NOT NULL AND score_pct > 0` filter (`lib/bridge-banco-analytics.ts:129`) means a session that genuinely scored `0/10` would be silently excluded from every KPI, not counted as a real failing session — which would inflate the pass rate. However, tracing the score-extraction expression (`SCORE_EXPR`, `:91-108`) shows this filter is very likely intentional defense, not a bug: the WHERE clause only requires `closingretro LIKE '%Score Global de la Sesion%'` (`:128`), a looser match than the exact `'Score Global de la Sesion</b>: '` delimiter the extraction logic searches for. A row whose HTML doesn't use that exact literal (different markup, no trailing `: `) makes `SUBSTRING_INDEX` fall through to the original un-parsed string, which then fails `CAST(... AS DECIMAL)` and produces exactly `0` — indistinguishable, by construction, from a genuine zero score. **Whether this rating system's evaluator can ever produce a genuine `0/10`, and whether the extraction ever actually hits this fallthrough on real data, cannot be determined without inspecting real `closingretro` rows.** Not changed. **Action if this needs resolving**: sample real Banco `closingretro` values where the computed `score_pct` would be exactly `0` under the current expression, and check by hand whether they're genuine zero scores or malformed HTML.

### 5.4 Two independent Banco pipelines with no shared "total sessions" definition
`bridge-banco-analytics.ts` (coach_users + email-domain filter + free-text score parsing) and `bridge-banco.ts` (banco_users hierarchy + round counts, no scoring) are structurally different systems over different table sets. If any consumer ever shows both side by side for "the same tenant," their session/user counts will not reconcile — this is inherent to them being different real pipelines, not a bug in either one individually. No fix applicable without a product decision on which pipeline is authoritative for Banco going forward.

### 5.5 `bridge-banco-analytics.ts` Trends: null daily average coerced to `0`
The Trends endpoint's daily average score defaults an all-null day to `0` (unlike its own Overview, which correctly returns `null`). Whether the frontend chart already treats "0" and "no data that day" identically (in which case this is harmless) or would visually show a false zero-score day couldn't be confirmed without reading the consuming chart component — left unchanged pending that check rather than guessing at chart behavior.

### 5.6 `bridge-rolplay-app.ts` / Python sibling: latent zero-fallback in Best Performers
Both `rolplayAppBestPerformers` (`lib/bridge-rolplay-app.ts:745-746`) and its Python port (`ai-service/app/preview_fetch.py`) fall back `avg_score`/`pass_rate` to `0` instead of `null` when a row has no scored sessions. Confirmed **currently unreachable** in both languages: the query's own `HAVING COUNT(SCORE_SQL) > 0` guarantees every returned row already has `scored > 0`, so the `0` branch never executes today. Not changed — there is no live incorrect output to fix, and touching dead code carries real regression risk for zero benefit. Worth revisiting only if that `HAVING` guard is ever removed.

### 5.7 `bridge-client.ts` `passFailTrend` denominator vs. `evalCountTrend`
`passFailTrend` (defined-result sessions only) and `evalCountTrend` (all sessions) use different populations for nominally-parallel daily series in the same file. Same root cause as §5.2 (`passed_flag` NULL handling) — flagged there, not duplicated as a separate fix.

---

## 6. Verified correct despite looking unusual (no action taken)

- **Cesar KPIs (Activation Rate, MAU Rate, Weekly Practice Frequency, Delta Score, Readiness Index, Mastery Distribution, Commercial Domain, Top Strengths/Opportunities, Adoption Movement Rate)** — `lib/bridge-rolplay-app.ts:820-1063` and `ai-service/app/preview_fetch.py` equivalents. Verified as a deliberate, synchronized TS/Python port: same formulas, same `null`-not-fabricated edge cases, same previously-fixed Readiness-Index capped-numerator/uncapped-denominator bug (now correct in both languages), same honest `sampled:true` disclosure when a `LIMIT 500` per-user scan caps out. Matches the prior session's "Cesar KPI Assessment" memory (11/19 fully implemented) exactly. Several KPIs (Time-to-Mastery, Commercial Deviation Rate, Scientific Gap Frequency, Close Rate with Measurable Commitment) are explicitly *not implemented*, with in-code comments explaining exactly why (missing duration column; would require classifying free text into fabricated categories) — correct behavior, not a gap.
- **Activation Rate's "active-in-period ÷ all-time-enrolled" ratio** — numerator and denominator intentionally span different time windows; that is the definition of an activation rate, not a scoping bug.
- **`passFailTrend` being a raw count, not a percentage** (`lib/bridge-rolplay-app.ts`) — confirmed via `lib/trend-transform.ts:33` ("`'sum'` for count series") that this is documented, correctly-typed count data for a stacked count chart, not a mislabeled rate.
- **Results/Drilldown null-vs-fabricated-fail handling** — every source (`bridge-pharma-analytics.ts`, `bridge-rolplay-app.ts`, `bridge-client.ts` via ai-service, `bridge-banco-analytics.ts`) correctly shows `score:null, result:null` for an unscoreable session rather than a fabricated "fail." This was an explicitly-documented, already-fixed bug in `bridge-rolplay-app.ts` (comment at lines 602-604) from before this audit — confirmed the fix holds and the same discipline is applied consistently everywhere else.
- **Sanfer certification KPIs** — a "% completed all assigned simulations" concept, correctly labeled with its own legend rather than reusing the score-threshold "pass rate" language used elsewhere. Its Best Performers `pass_rate = finalized ? 100 : fasesCompleted/3*100` is a different, appropriate convention for what this KPI actually measures.
- **LMS (`lms.py`)** — `lms_avg_quiz_score` deliberately excludes exactly-`0` `average_score_rate` values (LearnWorlds reports `0` for ungraded courses, indistinguishable from a real zero) rather than deflating the average; every zero-denominator path returns `None`, never a fabricated rate. No LearnWorlds credentials → empty state, never borrowed/fabricated data.
- **No random/fabricated/demo data anywhere in the KPI computation paths.** Exhaustively grepped (`Math.random`, `random`, `Faker`, `fake`, `mock`, `demo`, `seed`, `synthetic`, `placeholder`) across every TS bridge and every ai-service Python file. The single `Math.random()` in the whole codebase (`lib/jwt.ts:27`) is a token-ID suffix, unrelated to any KPI. Every zero/missing-data path returns `null`/`None`/`[]`, never a placeholder number, with the narrow already-covered exceptions in §5.6.

---

## 7. Dashboard Builder planning layer (does not compute KPI values itself)

`ai-service/app/agents/dashboard_planning.py` selects which already-real `metric_key`s
get a tile/chart; it never invents a metric or a number. Verified guardrails:
- LLM widget-selection prompt: *"only use the exact metric key values and dimension
  names provided — never invent metrics, widgets, or data"* (`:526-538`); every LLM pick
  is re-validated against the real schema, and any real metric the LLM omits is force-
  added back.
- `insights.py` requires `MIN_GROUNDED_WIDGETS=2` real data points before writing any
  narrative sentence, and its prompt explicitly forbids inventing a figure/trend not
  present in the data.
- `journey.py` only renders the module-journey widget when ≥2 of exactly 5 canonical
  module names are present — refuses to force an unclassified module name into the
  ontology rather than guess at a mapping.
- Per-module pages (`_module_pages`) are restricted to `rolplay_app_sql` only — the one
  connector with exact, verified module→query scoping; `pharma_kpi` is explicitly denied
  per-module pages to avoid guessing a Coach/Simulator split from an unclassified
  `activity_type` string.

No corrections needed in this layer — the anti-fabrication guardrails already match
the standard this audit was checking for.

---

## 8. Summary

| Category | Count |
|---|---|
| Corrections implemented | 1 (bridge-banco.ts LEFT JOIN fix, 4 affected KPIs) |
| Flagged — cannot determine, not changed | 7 |
| Verified correct despite looking unusual | 7 groups |
| Fabricated/random data found | 0 |
