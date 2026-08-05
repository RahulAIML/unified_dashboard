"""Agent 5 — Dashboard Planning (Gemini-driven, heuristic fallback).

The LLM proposes the layout/titles/recommendations, but every metric &
dimension it references is enforced against the discovered schema — so it can
reorganize and label, never invent data. If the LLM is unavailable or returns
nothing usable, a deterministic heuristic produces the same shape.
"""
from __future__ import annotations

import json

from .. import journey as journey_lib
from ..llm import gemini_json, llm_available
from ..preview_fetch import (
    ADOPTION_MOVEMENT_ID,
    BEST_PERFORMERS_ID,
    CESAR_METRIC_KEYS,
    COMMERCIAL_DOMAIN_ID,
    DAILY_PASSFAIL_ID,
    MASTERY_DISTRIBUTION_ID,
    TOP_OPPORTUNITIES_ID,
    TOP_STRENGTHS_ID,
)
from ..models import (
    DashboardFilter,
    DashboardPage,
    DashboardRow,
    MetricType,
    NormalizedSchema,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)
from .base import LogFn

_ALLOWED_CHART = {"line_chart", "bar_chart", "donut", "histogram"}

# Metric keys that belong on their own LMS page, never on Overview — see
# agents/lms_discovery.py, which is the only thing that ever adds these.
_LMS_METRIC_KEYS = {
    "lms_enrolled_users", "lms_completion_rate", "lms_avg_quiz_score",
    "lms_modules_completed", "lms_completion_trend", "lms_courses",
}

# Human-readable page title per connector kind, used ONLY for a secondary
# connector's page (see _secondary_page) — the primary connector's page is
# always titled "Overview" regardless of kind. Generic on purpose: this maps
# a CONNECTOR KIND to a label, never a tenant/company name.
_KIND_LABEL = {
    ServiceKind.pharma_kpi: "Activity Tracking",
    ServiceKind.pharma_sale_exercises: "Practice Sessions",
    ServiceKind.pharma_exceltis_rest: "Activity Tracking",
    ServiceKind.rolplay_app_sql: "Practice Simulator",
    ServiceKind.coach_app_sql: "Coach Analytics",
    ServiceKind.second_brain: "Second Brain",
}


async def run(
    schema: NormalizedSchema, log: LogFn, secondary_schema: NormalizedSchema | None = None,
) -> tuple[list[DashboardPage], list[DashboardFilter], list[str]]:
    metrics = {m.key: m for m in schema.metrics}

    plan = None
    if llm_available() and schema.metrics:
        plan = await _llm_plan(schema)
        if plan:
            await log("dashboard_planning", "info", "Gemini proposed the layout; validating against real metrics…")

    if plan:
        overview_rows, filters, recs = _build_from_plan(plan, schema, metrics)
        if any(r.widgets for r in overview_rows):
            pages = _assemble_pages(schema, metrics, overview_rows, secondary_schema)
            total = sum(len(r.widgets) for p in pages for r in p.rows)
            await log("dashboard_planning", "success",
                      f"Gemini plan → {total} widget(s) across {len(pages)} page(s), {len(filters)} filter(s)")
            return pages, filters, recs
        await log("dashboard_planning", "warn", "Gemini plan had no valid widgets — using heuristic")

    overview_rows, filters, recs = _heuristic(schema, metrics)
    pages = _assemble_pages(schema, metrics, overview_rows, secondary_schema)
    total = sum(len(r.widgets) for p in pages for r in p.rows)
    await log("dashboard_planning", "success",
              f"Heuristic plan → {total} widget(s) across {len(pages)} page(s), {len(filters)} filter(s)")
    return pages, filters, recs


def _assemble_pages(
    schema: NormalizedSchema, metrics: dict, overview_rows: list[DashboardRow],
    secondary_schema: NormalizedSchema | None = None,
) -> list[DashboardPage]:
    """Turns the existing single-page widget set into a real multi-page
    dashboard: Overview (unchanged content) + an LMS page (when LMS was
    discovered — see lms_discovery.py) + one page per canonical module the
    connector can query in isolation (today: rolplay_app_sql only — see
    _module_pages' own docstring for why pharma_kpi doesn't get these yet)
    + one page for a SECONDARY connector's own data, if one was found
    alongside the primary (see agents/service_discovery.py::pick_secondary —
    e.g. Besins' 17 real coach_app_sql sessions, previously dropped entirely
    because rolplay_app_sql won primary). Always at least one page
    (Overview), so nothing regresses for a schema with none of the above.
    """
    pages = [DashboardPage(id="overview", title="Overview", rows=overview_rows)]
    lms_page = _lms_page(metrics)
    if lms_page:
        pages.append(lms_page)
    pages.extend(_module_pages(schema, metrics))
    secondary_page = _secondary_page(secondary_schema)
    if secondary_page:
        pages.append(secondary_page)
    ranking_page = _ranking_page(schema)
    if ranking_page:
        pages.append(ranking_page)
    activities_page = _activities_page(schema)
    if activities_page:
        pages.append(activities_page)
    cesar_kpis_page = _cesar_kpis_page(schema)
    if cesar_kpis_page:
        pages.append(cesar_kpis_page)
    reports_page = _reports_page(schema)
    if reports_page:
        pages.append(reports_page)
    return pages


def _ranking_page(schema: NormalizedSchema) -> DashboardPage | None:
    """A dedicated Ranking/Leaderboard page — matches the reference hand-built
    per-tenant dashboards (docs/sanfer-dashboard-inventory.md's "Clasificación"
    nav item, and the standalone Siigo dashboard's own "Mejores Desempeños ...
    Ver todo" pattern), which give the leaderboard both a summary card on
    Overview AND its own full page. The widget id is prefixed (not the bare
    BEST_PERFORMERS_ID Overview's own leaderboard card already uses) purely to
    avoid a duplicate-widget-id collision across the dashboard — it still ends
    with BEST_PERFORMERS_ID, so preview_fetch.py's id-based routing picks it
    up via the same query, same real data, no backend change needed.

    rolplay_app_sql ONLY, same reason as every other auto-page here: it's the
    one connector with a verified per-user query shape for this.
    """
    if not any(m.source_kind == ServiceKind.rolplay_app_sql for m in schema.metrics):
        return None
    src = next(m for m in schema.metrics if m.source_kind == ServiceKind.rolplay_app_sql)
    widget = WidgetConfig(
        id=f"ranking_{BEST_PERFORMERS_ID}", type=WidgetType.table, title="Best Performers",
        source_kind=src.source_kind, source_action="r_user_session", span=4,
        business_question="Which reps have the highest average score?",
    )
    return DashboardPage(id="ranking", title="Ranking", rows=[
        DashboardRow(id="ranking_table", title="Leaderboard", widgets=[widget]),
    ])


def _cesar_kpis_page(schema: NormalizedSchema) -> DashboardPage | None:
    """A dedicated KPIs page implementing "Sugerencia de KPI's Cesar.xlsx" —
    19 KPIs the tech lead specified, across 5 perspectives (Adoption & Usage,
    Efficiency & Acceleration, Technical Diagnostics, Commercial
    Effectiveness, Impact & Prescription). Confirmed against real live data
    before building anything:

    GROUP 1 (this page's first row) is schema-only — activation rate, weekly
    practice frequency, MAU, practices-to-mastery, competency gain (delta
    score), field readiness index, and the Basic/Intermediate/Advanced
    mastery distribution. Computed from r_user/r_user_session/SCORE_SQL
    alone (preview_fetch.py's _rolplay_app_cesar_metrics), so these work for
    ANY rolplay_app_sql tenant.

    GROUP 2 (this page's second row) depends on raw_closing_data carrying a
    rich per-session evaluation JSON — confirmed real and richly structured
    for Siigo (5 scored commercial-domain blocks, 24 individually-scored
    checklist items, an adoption-intent movement field) via direct live
    querying, and confirmed ABSENT for Takeda (raw_closing_data is NULL for
    every one of its sessions — scored via closing_analysis HTML only).
    preview_fetch.py's widgets for this group discover whatever bloque_*/
    rubrica_pN_* keys exist per session dynamically (regex, never a
    hardcoded Siigo field list), so they work for any tenant/product whose
    AI evaluator produces this shape and report "no data" (not a fabricated
    zero) for one that doesn't — same rule as every other widget here.

    KPI-2.4 Trial-and-Error Index (added 2026-08-05, re-audited against the
    real spreadsheet): % of Certifier attempts with no prior Coach session
    for that user. Computed from real cross-category session sequencing
    (preview_fetch.py's _rolplay_app_cesar_metrics) — real only for a tenant
    whose r_simulator.category actually has a Certifier ("SEGMENT") module;
    confirmed live most tenants (Siigo/Rowe/Armstrong/Sanfer) don't, M8 does.
    Reports "no data" rather than a fabricated rate for everyone else.

    NOT implemented, and why (documented rather than silently skipped):
      - KPI-2.1 Time-to-Mastery (minutes to reach mastery): r_user_session
        has no duration/time-spent column anywhere in the schema (confirmed
        via a live full-row SELECT) — not computable without fabricating a
        number the platform never recorded.
      - KPI-3.1 Average Technical Mastery: ambiguous whether this should be
        a distinct sub-score from the existing overall avg_score, or
        identical to it — the raw_closing_data fields that read as
        "technical" (product_knowledge_accuracy etc.) are free-text quality
        labels, not scores, for every session sampled.
      - KPI-3.3 Commercial Deviation Rate, KPI-3.4 Scientific Gap Frequency,
        KPI-5.2 Close Rate with Measurable Commitment: would require
        classifying free-text fields (areas_for_improvement /
        resultado_comercial / rubrica item names) into fixed categories by
        keyword-matching — risks a fabricated classification rule rather
        than a real, evidenced measurement. Re-checked live for 3.4
        specifically: Siigo's 24 rubrica items are all sales-process
        checklist entries, none tag a distinct "technical/scientific
        concept" — same problem as 3.3/5.2, not a separate case.
      - KPI-4.4 Objection Conversion Index: the "Romper el No" domain in the
        Score by Commercial Domain widget already surfaces objection-
        handling performance; a separate metric would double-count the same
        underlying data under a different label.

    rolplay_app_sql ONLY, same reason as every other auto-page here.
    """
    if not any(m.source_kind == ServiceKind.rolplay_app_sql for m in schema.metrics):
        return None
    src = next(m for m in schema.metrics if m.source_kind == ServiceKind.rolplay_app_sql)

    def tile(key: str, title: str, question: str) -> WidgetConfig:
        return WidgetConfig(id=f"tile_cesar_{key}", type=WidgetType.kpi_tile, title=title,
                            metric_key=key, source_kind=src.source_kind,
                            source_action="r_user_session", business_question=question)

    group1 = [
        tile("activation_rate", "Activation Rate", "What % of enrolled reps have started at least one session?"),
        tile("weekly_practice_frequency", "Weekly Practice Frequency", "How many sessions run per active week, on average?"),
        tile("mau_rate", "Recurring Adoption (MAU)", "What % of reps used the platform in the last 30 days?"),
        tile("practices_to_mastery", "Practices to Mastery", "How many attempts does it take to reach mastery (>=95)?"),
        tile("delta_score", "Competency Gain (Delta Score)", "How much do reps improve from their first to their most recent session?"),
        tile("readiness_index", "Field Readiness Index", "What % of the sales force has reached mastery-level certification?"),
        tile("trial_and_error_rate", "Trial-and-Error Index", "What % of certification attempts happened with no prior coaching?"),
    ]
    mastery_widget = WidgetConfig(
        id=MASTERY_DISTRIBUTION_ID, type=WidgetType.donut, title="Distribution by Mastery Level",
        source_kind=src.source_kind, source_action="r_user_session", span=2,
        business_question="What share of the team is Basic / Intermediate / Advanced?",
    )
    adoption_widget = WidgetConfig(
        id=ADOPTION_MOVEMENT_ID, type=WidgetType.kpi_tile, title="Adoption Movement Rate",
        source_kind=src.source_kind, source_action="r_user_session", span=2,
        business_question="What % of sessions moved the customer's adoption intent forward?",
    )
    domain_widget = WidgetConfig(
        id=COMMERCIAL_DOMAIN_ID, type=WidgetType.table, title="Score by Commercial Domain",
        source_kind=src.source_kind, source_action="r_user_session", span=4,
        business_question="In which stage of the sales interaction does the team struggle most?",
    )
    strengths_widget = WidgetConfig(
        id=TOP_STRENGTHS_ID, type=WidgetType.table, title="Top Commercial Strengths",
        source_kind=src.source_kind, source_action="r_user_session", span=2,
        business_question="Which skills does the team consistently execute well?",
    )
    opportunities_widget = WidgetConfig(
        id=TOP_OPPORTUNITIES_ID, type=WidgetType.table, title="Top Areas of Opportunity",
        source_kind=src.source_kind, source_action="r_user_session", span=2,
        business_question="Which specific habits most often fail across real sessions?",
    )

    return DashboardPage(id="kpis", title="KPIs", rows=[
        DashboardRow(id="kpis_group1", title="Adoption, Efficiency & Readiness", widgets=[*group1, mastery_widget]),
        DashboardRow(id="kpis_group2", title="Commercial Effectiveness & Impact",
                    widgets=[adoption_widget, domain_widget, strengths_widget, opportunities_widget]),
    ])


def _activities_page(schema: NormalizedSchema) -> DashboardPage | None:
    """A dedicated Activities page — matches the reference dashboards'
    "Actividades" nav item (per-activity/per-simulator breakdown as its own
    page). Reuses the SAME per-simulator breakdown query every bar_chart/
    donut/table widget on Overview already runs (preview_fetch.py routes by
    widget TYPE, not id, for this branch) -- these are new widget ids so they
    don't collide with Overview's own breakdown widgets, but they fetch
    identically real data, just laid out as their own page.

    rolplay_app_sql ONLY, same reason as _ranking_page.
    """
    if not any(m.source_kind == ServiceKind.rolplay_app_sql for m in schema.metrics):
        return None
    src = next(m for m in schema.metrics if m.source_kind == ServiceKind.rolplay_app_sql)
    widgets = [
        WidgetConfig(id="activities_chart_breakdown", type=WidgetType.bar_chart,
                     title="Sessions by Simulator", source_kind=src.source_kind,
                     source_action="r_user_session", span=2),
        WidgetConfig(id="activities_donut_breakdown", type=WidgetType.donut,
                     title="Simulator — Share", source_kind=src.source_kind,
                     source_action="r_user_session", span=2),
        WidgetConfig(id="activities_table_breakdown", type=WidgetType.table,
                     title="Simulator — detail", source_kind=src.source_kind,
                     source_action="r_user_session", span=4,
                     business_question="Which simulators are used most, and how do they perform?"),
    ]
    return DashboardPage(id="activities", title="Activities", rows=[
        DashboardRow(id="activities_breakdown", title="Per-Simulator Breakdown", widgets=widgets),
    ])


def _reports_page(schema: NormalizedSchema) -> DashboardPage | None:
    """A real Reports page: every individual session as its own row (not
    aggregated by simulator, unlike Overview's breakdown table), with real
    pagination/search/CSV-export metadata for the frontend to act on.

    rolplay_app_sql ONLY, for now — that's the one connector with a proven
    query shape for this (r_user_session/r_user/r_simulator, already used
    by the breakdown and drilldown widgets), and the only one this pass
    was scoped to touch. Other connectors are completely untouched.
    """
    if not any(m.source_kind == ServiceKind.rolplay_app_sql for m in schema.metrics):
        return None
    src = next(m for m in schema.metrics if m.source_kind == ServiceKind.rolplay_app_sql)
    widget = WidgetConfig(
        id="table_reports", type=WidgetType.table, title="Session Reports",
        source_kind=src.source_kind, source_action="r_user_session", span=4,
        paginated=True, searchable=True, exportable=True,
        business_question="Which individual sessions were run, by whom, and with what result?",
    )
    return DashboardPage(id="reports", title="Reports", rows=[
        DashboardRow(id="reports_table", title="All Sessions", widgets=[widget]),
    ])


def _secondary_page(secondary_schema: NormalizedSchema | None) -> DashboardPage | None:
    """A page built entirely from a SECONDARY connector's own schema — reuses
    _heuristic()'s generic tile/chart-building (it already works for any
    NormalizedSchema, regardless of which connector produced it), so this
    adds no new widget-construction logic, just a distinct titled page.
    Returns None when there's no secondary source, or it has no real metrics
    (e.g. it needs exercise IDs the pipeline doesn't have — additive only,
    never blocks the rest of the dashboard).
    """
    if not secondary_schema or not secondary_schema.metrics:
        return None
    rows, _filters_unused, _recs_unused = _heuristic(secondary_schema, {m.key: m for m in secondary_schema.metrics})
    if not any(r.widgets for r in rows):
        return None
    kind = secondary_schema.metrics[0].source_kind
    title = _KIND_LABEL.get(kind, kind.value.replace("_", " ").title())
    # _heuristic() ids its widgets generically ("tile_total_sessions",
    # "chart_trend", ...) -- fine when it's the only page, but the primary's
    # Overview page uses the exact same scheme for the exact same common
    # metric keys (total_sessions/avg_score/...), so without a prefix the
    # two pages would emit COLLIDING widget ids across the dashboard (found
    # by test_no_duplicate_widget_ids_across_the_whole_dashboard's sibling
    # test for this page). Prefix every widget id with the connector kind to
    # keep them unique dashboard-wide, matching how _module_pages prefixes
    # with the module name for the same reason.
    prefix = f"secondary_{kind.value}_"
    prefixed_rows = [
        DashboardRow(id=f"{prefix}{row.id}", title=row.title,
                     widgets=[w.model_copy(update={"id": f"{prefix}{w.id}"}) for w in row.widgets])
        for row in rows
    ]
    return DashboardPage(id=f"secondary_{kind.value}", title=title, rows=prefixed_rows)


def _lms_page(metrics: dict) -> DashboardPage | None:
    tile_keys = ["lms_enrolled_users", "lms_completion_rate", "lms_avg_quiz_score", "lms_modules_completed"]
    tiles = []
    for key in tile_keys:
        m = metrics.get(key)
        if not m:
            continue
        tiles.append(WidgetConfig(id=f"lms_tile_{key}", type=WidgetType.kpi_tile, title=m.label,
                                  metric_key=key, source_kind=m.source_kind, source_action=m.source_action))
    if not tiles:
        return None  # no LMS discovered for this tenant

    rows = [DashboardRow(id="lms_kpis", title="Overview", widgets=tiles)]

    charts: list[WidgetConfig] = []
    trend_m = metrics.get("lms_completion_trend")
    if trend_m:
        charts.append(WidgetConfig(id="lms_trend", type=WidgetType.line_chart, title=trend_m.label,
                                   source_kind=trend_m.source_kind, source_action=trend_m.source_action, span=4))
    courses_m = metrics.get("lms_courses")
    if courses_m:
        charts.append(WidgetConfig(id="lms_courses_table", type=WidgetType.table, title="Courses",
                                   source_kind=courses_m.source_kind, source_action=courses_m.source_action, span=4))
    if charts:
        rows.append(DashboardRow(id="lms_analytics", title="Analytics", widgets=charts))

    return DashboardPage(id="lms", title="LMS", rows=rows)


def _module_pages(schema: NormalizedSchema, metrics: dict) -> list[DashboardPage]:
    """Per-module (Coach-only / Simulator-only / Certification-only) pages,
    each with its own scoped KPIs/trend/table — matching the real hand-built
    app's per-module pages, which show module-scoped numbers rather than one
    aggregate across every module.

    ONLY for connectors where the module->query scoping is exact and
    verified, never a guess: today that's rolplay_app_sql, whose modules are
    already the canonical r_simulator.category mapping (journey.py's
    CATEGORY_TO_MODULE). pharma_kpi's modules are raw, unclassified
    activity_type strings (e.g. "Coach evaluador") with no general
    Coach-vs-Simulator classifier built yet — forcing them into per-module
    pages here would mean guessing, so pharma_kpi tenants get Overview + LMS
    only until that classification work exists, not a wrong per-module split.
    """
    dim = next((m for m in schema.metrics if m.type == MetricType.dimension), None)
    if not dim or dim.source_kind != ServiceKind.rolplay_app_sql:
        return []
    canonical = [m for m in schema.modules if m in journey_lib.CANONICAL_ORDER]
    if not canonical:
        return []
    ts = next((m for m in schema.metrics if m.type == MetricType.timeseries), None)

    pages: list[DashboardPage] = []
    for module in journey_lib.ordered_stages(canonical):
        label = journey_lib.LABEL[module]
        tiles = [
            WidgetConfig(id=f"{module}_tile_total_sessions", type=WidgetType.kpi_tile, title="Total Sessions",
                        metric_key="total_sessions", module=module,
                        source_kind=dim.source_kind, source_action=dim.source_action),
            WidgetConfig(id=f"{module}_tile_avg_score", type=WidgetType.kpi_tile, title="Average Score",
                        metric_key="avg_score", module=module,
                        source_kind=dim.source_kind, source_action=dim.source_action),
            WidgetConfig(id=f"{module}_tile_pass_rate", type=WidgetType.kpi_tile, title="Pass Rate",
                        metric_key="pass_rate", module=module,
                        source_kind=dim.source_kind, source_action=dim.source_action),
        ]
        rows = [DashboardRow(id=f"{module}_kpis", title="Overview", widgets=tiles)]

        charts: list[WidgetConfig] = []
        if ts:
            charts.append(WidgetConfig(id=f"{module}_trend", type=WidgetType.line_chart, title="Score Trend",
                                       module=module, source_kind=ts.source_kind, source_action=ts.source_action, span=4))
        charts.append(WidgetConfig(
            id=f"{module}_table", type=WidgetType.table, title=f"{label} — detail",
            dimension=schema.dimensions[0] if schema.dimensions else "category", module=module,
            metrics=[k for k in ("total_sessions", "avg_score", "pass_rate") if k in metrics],
            source_kind=dim.source_kind, source_action=dim.source_action, span=4,
        ))
        rows.append(DashboardRow(id=f"{module}_analytics", title="Analytics", widgets=charts))
        pages.append(DashboardPage(id=module, title=label, rows=rows))
    return pages


# ── LLM path ─────────────────────────────────────────────────────────────────────
async def _llm_plan(schema: NormalizedSchema) -> dict | None:
    system = (
        "You are a senior analytics dashboard designer. Given the metrics and "
        "dimensions ALREADY DISCOVERED for a company, design a clean executive "
        "dashboard. HARD RULES: only use the exact metric `key` values and "
        "dimension names provided — never invent metrics, widgets, or data. "
        "Prefer 3-5 KPI tiles, AT MOST ONE trend chart (only if a timeseries "
        "metric exists), and AT MOST ONE breakdown chart plus AT MOST ONE table "
        "(only if a dimension metric exists). Each data source in this system "
        "backs exactly one real query per widget type — proposing two charts "
        "of the same type (e.g. two bar_charts) would render IDENTICAL data "
        "under different titles, which is forbidden. Never propose more than "
        "one widget of the same `type`. Return STRICT JSON only."
    )
    payload = {
        "company": schema.company,
        # LMS metrics are deliberately excluded — they always get their own
        # dedicated page (_lms_page), built deterministically, never left to
        # the LLM to place alongside unrelated Overview metrics.
        # Cesar metrics excluded too -- they always get their own dedicated
        # KPIs page (_cesar_kpis_page), same reasoning as LMS.
        "metrics": [{"key": m.key, "label": m.label, "type": m.type.value}
                    for m in schema.metrics if m.key not in _LMS_METRIC_KEYS and m.key not in CESAR_METRIC_KEYS],
        "dimensions": schema.dimensions,
        "modules": schema.modules,
        "date_range": schema.date_range,
    }
    user = (
        "Design the dashboard for this schema:\n" + json.dumps(payload) +
        '\n\nReturn JSON of the form:\n'
        '{"tiles":["metric_key",...],'
        '"charts":[{"id":"chart_x","type":"line_chart|bar_chart|donut|histogram",'
        '"title":"...","metric_key":"metric_key_for_series_or_null",'
        '"dimension":"dimension_name_or_null"}],'
        '"recommendations":["short actionable sentence", ...]}'
    )
    result = await gemini_json(system, user)
    return result if isinstance(result, dict) else None


def _build_from_plan(plan: dict, schema: NormalizedSchema, metrics: dict):
    tiles: list[WidgetConfig] = []
    tile_keys: set[str] = set()
    for key in plan.get("tiles", []):
        m = metrics.get(key)
        if (not m or m.type not in (MetricType.count, MetricType.score, MetricType.rate)
                or key in tile_keys or key in _LMS_METRIC_KEYS or key in CESAR_METRIC_KEYS):
            continue  # enforce: real metric only, never an LMS or Cesar metric here — those get their own page
        tile_keys.add(key)
        tiles.append(WidgetConfig(id=f"tile_{key}", type=WidgetType.kpi_tile, title=m.label,
                                  metric_key=key, source_kind=m.source_kind, source_action=m.source_action,
                                  raw_field=m.raw_field, business_question=m.business_question))
    # Gemini picks which tiles to feature/order, but every count/score/rate
    # metric that schema_discovery genuinely confirmed real (e.g. Sanfer's
    # certification stats) must still show up — an LLM's own summarization
    # picking "3-5 typical KPIs" is not grounds to silently drop a real one.
    for m in schema.metrics:
        if (m.key in tile_keys or m.type not in (MetricType.count, MetricType.score, MetricType.rate)
                or m.key in _LMS_METRIC_KEYS or m.key in CESAR_METRIC_KEYS):
            continue
        tile_keys.add(m.key)
        tiles.append(WidgetConfig(id=f"tile_{m.key}", type=WidgetType.kpi_tile, title=m.label,
                                  metric_key=m.key, source_kind=m.source_kind, source_action=m.source_action,
                                  raw_field=m.raw_field, business_question=m.business_question))

    # DEDUP GUARD: every connector's preview layer implements at most ONE real
    # query per widget TYPE (one trend series, one dimension breakdown) — see
    # preview_fetch.py, where any non-tile widget of a given connector routes to
    # the same underlying rows regardless of its title. Without this cap, an
    # LLM can propose several differently-titled charts ("usecase performance",
    # "user engagement", "pass rate breakdown") that all silently render
    # identical data — exactly the "same numbers relabeled" failure this
    # pipeline exists to prevent. So: keep at most the FIRST proposed widget of
    # each type; a bar_chart + a table of the SAME breakdown is fine (that's
    # one analysis shown two ways, like Apotex's real dashboard), but a second
    # bar_chart or a second table is dropped, not silently duplicated.
    seen_types: set[str] = set()
    charts: list[WidgetConfig] = []
    for c in plan.get("charts", []):
        ctype = str(c.get("type", "")).lower()
        if ctype not in _ALLOWED_CHART or ctype in seen_types:
            continue
        mkey = c.get("metric_key")
        dim = c.get("dimension")
        if dim and dim not in schema.dimensions:
            dim = schema.dimensions[0] if schema.dimensions else None
        # a chart must be backed by a real metric or a real dimension — never
        # an LMS metric here, those only ever appear on their own page.
        if mkey in _LMS_METRIC_KEYS or mkey in CESAR_METRIC_KEYS:
            mkey = None
        src_metric = (
            metrics.get(mkey) if mkey in metrics
            else next((m for m in schema.metrics if m.key not in _LMS_METRIC_KEYS and m.key not in CESAR_METRIC_KEYS), None)
        )
        if not src_metric:
            continue
        seen_types.add(ctype)
        charts.append(WidgetConfig(
            id=str(c.get("id") or f"chart_{len(charts)}"),
            type=WidgetType(ctype), title=str(c.get("title") or src_metric.label),
            metric_key=mkey if mkey in metrics else None,
            dimension=dim, metrics=[k for k in ("total_sessions",) if k in metrics],
            source_kind=src_metric.source_kind, source_action=src_metric.source_action,
            span=2 if ctype != "histogram" else 2,
        ))
    # Always offer a detail table if a dimension exists — but only if the plan
    # didn't already include one (same dedup rule: one real table query exists).
    if "table" not in seen_types and any(m.type == MetricType.dimension for m in schema.metrics):
        dm = next(m for m in schema.metrics if m.type == MetricType.dimension)
        charts.append(WidgetConfig(
            id="table_breakdown", type=WidgetType.table, title=f"{dm.label} — detail",
            dimension=schema.dimensions[0] if schema.dimensions else "category",
            metrics=[k for k in ("total_sessions", "avg_score", "pass_rate") if k in metrics],
            source_kind=dm.source_kind, source_action=dm.source_action, span=4))

    # Auto-discovered table-shaped metrics (e.g. Sanfer's objections/cert
    # breakdowns) are each a genuinely distinct real dataset, not competing
    # copies of the same query — so they bypass the one-per-type dedup above
    # and are always all included, one widget per source action.
    charts.extend(_auto_table_widgets(schema))
    charts.extend(_auto_donut_widgets(schema, {c.id for c in charts}))
    charts.extend(_auto_journey_widget(schema, {c.id for c in charts}))
    charts.extend(_auto_drilldown_table(schema, {c.id for c in charts}))
    charts.extend(_auto_best_performers_widget(schema, {c.id for c in charts}))
    charts.extend(_auto_daily_passfail_widget(schema, {c.id for c in charts}))

    rows: list[DashboardRow] = []
    if tiles:
        rows.append(DashboardRow(id="row_kpis", title="Overview", widgets=tiles))
    if charts:
        rows.append(DashboardRow(id="row_charts", title="Analytics", widgets=charts))
    filters = _filters(schema)
    recs = [str(r) for r in plan.get("recommendations", []) if isinstance(r, str)][:6] or _recs(schema, metrics)
    return rows, filters, recs


def _auto_journey_widget(schema: NormalizedSchema, existing_ids: set[str]) -> list[WidgetConfig]:
    """The ordered service-journey widget (see app/journey.py) — added only
    when schema.modules is evidence-backed enough to place in the canonical
    LMS -> Master Coach -> Practice Simulator -> Certification -> Second
    Brain ontology: every discovered module must already be one of those 5
    names (e.g. rolplay_app_sql's schema_discovery maps r_simulator.category
    through _CATEGORY_TO_MODULE before this ever runs), and there must be
    >=2 of them to show a progression at all — mirrors lib/journey.ts's
    hasJourney() exactly, so the same tenant sees the same journey shape here
    as on the hand-built /journey page.

    Deliberately does NOT fire for schemas whose modules are raw, unclassified
    strings (e.g. pharma_kpi's activity_type values like "Coach evaluador") —
    forcing those into this 5-module ontology would be exactly the kind of
    unverified low-confidence mapping this pipeline exists to avoid making
    silently. Those tenants simply get no journey widget rather than a wrong
    one.
    """
    if "journey" in existing_ids or not schema.metrics:
        return []
    if not journey_lib.has_journey(schema.modules):
        return []
    return [WidgetConfig(
        id="journey", type=WidgetType.journey, title="Solution Journey",
        source_kind=schema.metrics[0].source_kind, source_action="journey", span=4,
    )]


def _auto_donut_widgets(schema: NormalizedSchema, existing_ids: set[str]) -> list[WidgetConfig]:
    """Every connector's preview layer already computes a per-category
    breakdown (session share) and, wherever a pass/fail concept exists, a
    passed count alongside it (see preview_fetch.py's _approval_donut) — but
    until now nothing ever turned that into a donut, because the LLM planner
    only proposes one at its own discretion. A real client's hand-built
    Overview page (the bar we're matching) always pairs its bar/table
    breakdown with a session-share donut AND a pass/fail donut; adding both
    here deterministically means every dashboard gets that same variety
    regardless of what Gemini happened to plan, for any connector — donut
    rendering for both widget ids is already implemented per-kind in
    preview_fetch.py, and reuses the SAME rows the bar_chart/table already
    fetch, so this adds zero extra queries.

    The pass/fail donut is routed by widget id ("donut_approval"), not by
    metric_key: metric_key is validation.py's contract for "a real,
    schema_discovery-verified metric" (never invent metrics), and this donut
    is a genuine aggregation of already-real per-category rows rather than a
    standalone discovered metric — giving it a metric_key that isn't in
    schema.metrics would trip validation's missing_metric check even though
    the underlying data is completely real.
    """
    extra: list[WidgetConfig] = []
    dim = next((m for m in schema.metrics if m.type == MetricType.dimension), None)
    if not dim:
        return extra
    if "donut_breakdown" not in existing_ids:
        extra.append(WidgetConfig(
            id="donut_breakdown", type=WidgetType.donut, title=f"{dim.label} — Share",
            dimension=schema.dimensions[0] if schema.dimensions else "category",
            source_kind=dim.source_kind, source_action=dim.source_action, span=2,
        ))
    if "donut_approval" not in existing_ids and any(
        m.type == MetricType.rate and m.key not in _LMS_METRIC_KEYS and m.key not in CESAR_METRIC_KEYS
        for m in schema.metrics
    ):
        extra.append(WidgetConfig(
            id="donut_approval", type=WidgetType.donut, title="Pass / Fail Breakdown",
            dimension=schema.dimensions[0] if schema.dimensions else "category",
            source_kind=dim.source_kind, source_action=dim.source_action, span=2,
        ))
    return extra


def _auto_drilldown_table(schema: NormalizedSchema, existing_ids: set[str]) -> list[WidgetConfig]:
    """A 'Recent Sessions' table whose rows are individually click-through-
    able to /drilldown/[id] (the existing hand-built session-detail page).

    ONLY for coach_app_sql, because that's the one connector kind with a
    VERIFIED matching backend for it: lib/data-provider.ts's getDrilldown ->
    lib/bridge-client.ts's bridgeDrilldown queries the EXACT SAME
    report_field_current/saved_reports tables preview_fetch.py's _coach_app
    already queries, scoped server-side by the viewer's own customer_id.
    pharma_kpi/sale_exercises/exceltis_rest tenants resolve through a
    DIFFERENT drilldown path (pharmaDashboardDrilldown) that this pipeline
    has no verified handle-mapping for yet, and rolplay_app_sql has no
    working drilldown path documented anywhere — guessing wiring for either
    would risk linking to the wrong tenant's data or a 404, so both
    correctly get no drilldown table rather than a wrong one, matching this
    pipeline's rule throughout: never wire what isn't verified.
    """
    if "table_recent_sessions" in existing_ids or not schema.metrics:
        return []
    if not any(m.source_kind == ServiceKind.coach_app_sql for m in schema.metrics):
        return []
    src = next(m for m in schema.metrics if m.source_kind == ServiceKind.coach_app_sql)
    return [WidgetConfig(
        id="table_recent_sessions", type=WidgetType.table, title="Recent Sessions",
        id_field="saved_report_id", source_kind=src.source_kind,
        source_action="report_field_current", span=4,
    )]


# Connectors with a VERIFIED per-user identity field preview_fetch.py can
# actually group by -- rolplay_app_sql (r_user.email/name) confirmed from
# the ERD; pharma_exceltis_rest (Usuario_Nombre) confirmed live against real
# Heineken data (a full per-tenant parity audit found this connector's
# dashboards capped at 3 KPI tiles with no leaderboard, despite the raw rows
# already carrying a real name). Never guessed for a connector without a
# verified identity field -- pharma_kpi/pharma_sale_exercises/coach_app_sql
# stay out until their own row shapes are confirmed to carry one.
_LEADERBOARD_CONNECTORS = {ServiceKind.rolplay_app_sql, ServiceKind.pharma_exceltis_rest}


def _auto_best_performers_widget(schema: NormalizedSchema, existing_ids: set[str]) -> list[WidgetConfig]:
    """Top-users-by-average-score leaderboard, mirroring the hand-built
    Overview page's prominent "Best Performers" card (lib/bridge-rolplay-
    app.ts's rolplayAppBestPerformers, components/DashboardContent.tsx's
    Trophy-icon card) -- confirmed via a full parity audit against the real
    ERD/hand-built code to be entirely missing from every AI-generated
    rolplay_app_sql dashboard until now, and separately confirmed missing
    for pharma_exceltis_rest (Heineken) despite real per-user data existing.

    Scoped to _LEADERBOARD_CONNECTORS -- every connector with a VERIFIED
    per-user identity field preview_fetch.py can actually group by, never a
    guess for one that hasn't been confirmed.
    """
    if BEST_PERFORMERS_ID in existing_ids or not schema.metrics:
        return []
    if not any(m.source_kind in _LEADERBOARD_CONNECTORS for m in schema.metrics):
        return []
    src = next(m for m in schema.metrics if m.source_kind in _LEADERBOARD_CONNECTORS)
    return [WidgetConfig(
        id=BEST_PERFORMERS_ID, type=WidgetType.table, title="Best Performers",
        source_kind=src.source_kind, source_action=src.source_action, span=4,
        business_question="Which reps have the highest average score?",
    )]


def _auto_daily_passfail_widget(schema: NormalizedSchema, existing_ids: set[str]) -> list[WidgetConfig]:
    """Daily session volume + passed count, mirroring the hand-built app's
    separate evalCountTrend/passFailTrend series (lib/bridge-rolplay-
    app.ts's rolplayAppTrends) -- the existing chart_trend/*_trend line_chart
    widget only ever showed avg score over time; this adds the daily
    volume/pass-rate half of that same picture, confirmed missing by the
    same ERD/hand-built parity audit as the leaderboard above.

    rolplay_app_sql ONLY, same reason as _auto_best_performers_widget.
    """
    if DAILY_PASSFAIL_ID in existing_ids or not schema.metrics:
        return []
    if not any(m.source_kind == ServiceKind.rolplay_app_sql for m in schema.metrics):
        return []
    src = next(m for m in schema.metrics if m.source_kind == ServiceKind.rolplay_app_sql)
    return [WidgetConfig(
        id=DAILY_PASSFAIL_ID, type=WidgetType.bar_chart, title="Daily Sessions & Pass Count",
        source_kind=src.source_kind, source_action="r_user_session", span=4,
        business_question="How many sessions run per day, and how many pass?",
    )]


def _auto_table_widgets(schema: NormalizedSchema) -> list[WidgetConfig]:
    # LMS's own table metric (lms_courses) is deliberately excluded — it
    # already gets a widget on the dedicated LMS page (_lms_page), and
    # including it here too would duplicate it onto Overview.
    return [
        WidgetConfig(id=f"table_{m.key}", type=WidgetType.table, title=m.label,
                     source_kind=m.source_kind, source_action=m.source_action, raw_field=m.raw_field, span=4)
        for m in schema.metrics if m.type == MetricType.table and m.key not in _LMS_METRIC_KEYS
    ]


# ── Heuristic fallback ─────────────────────────────────────────────────────────────
def _heuristic(schema: NormalizedSchema, metrics: dict):
    tiles = [WidgetConfig(id=f"tile_{m.key}", type=WidgetType.kpi_tile, title=m.label, metric_key=m.key,
                          source_kind=m.source_kind, source_action=m.source_action, raw_field=m.raw_field,
                          business_question=m.business_question)
             for m in schema.metrics
             # Cesar metrics excluded here -- found live on M8: they were
             # rendering TWICE, once as a raw tile on Overview via this
             # generic builder and once properly organized on the dedicated
             # KPIs page (_cesar_kpis_page below). They belong only there.
             if m.type in (MetricType.count, MetricType.score, MetricType.rate)
             and m.key not in _LMS_METRIC_KEYS and m.key not in CESAR_METRIC_KEYS]
    charts: list[WidgetConfig] = []
    ts = next((m for m in schema.metrics if m.type == MetricType.timeseries and m.key not in _LMS_METRIC_KEYS), None)
    if ts:
        charts.append(WidgetConfig(id="chart_trend", type=WidgetType.line_chart, title=ts.label,
                                   metrics=[ts.key], source_kind=ts.source_kind, source_action=ts.source_action, span=2))
    dim = next((m for m in schema.metrics if m.type == MetricType.dimension), None)
    if dim:
        charts.append(WidgetConfig(id="chart_breakdown", type=WidgetType.bar_chart, title=dim.label,
                                   dimension=schema.dimensions[0] if schema.dimensions else "category",
                                   metrics=["total_sessions"], source_kind=dim.source_kind, source_action=dim.source_action, span=2))
        charts.append(WidgetConfig(id="table_breakdown", type=WidgetType.table, title=f"{dim.label} — detail",
                                   dimension=schema.dimensions[0] if schema.dimensions else "category",
                                   metrics=[k for k in ("total_sessions", "avg_score", "pass_rate") if k in metrics],
                                   source_kind=dim.source_kind, source_action=dim.source_action, span=4))
    charts.extend(_auto_table_widgets(schema))
    charts.extend(_auto_donut_widgets(schema, {c.id for c in charts}))
    charts.extend(_auto_journey_widget(schema, {c.id for c in charts}))
    charts.extend(_auto_drilldown_table(schema, {c.id for c in charts}))
    charts.extend(_auto_best_performers_widget(schema, {c.id for c in charts}))
    charts.extend(_auto_daily_passfail_widget(schema, {c.id for c in charts}))
    rows: list[DashboardRow] = []
    if tiles:
        rows.append(DashboardRow(id="row_kpis", title="Overview", widgets=tiles))
    if charts:
        rows.append(DashboardRow(id="row_charts", title="Analytics", widgets=charts))
    return rows, _filters(schema), _recs(schema, metrics)


def _filters(schema: NormalizedSchema) -> list[DashboardFilter]:
    out: list[DashboardFilter] = []
    if schema.date_range or any(m.type == MetricType.timeseries for m in schema.metrics):
        out.append(DashboardFilter(key="date_range", label="Date range", type="date_range"))
    if schema.modules:
        out.append(DashboardFilter(key="module", label="Module", type="module", options=schema.modules))
    return out


def _recs(schema: NormalizedSchema, metrics: dict) -> list[str]:
    recs: list[str] = []
    if "avg_score" not in metrics:
        recs.append("This source records activity but not numeric scores — dashboard is counts-only.")
    if schema.modules:
        recs.append(f"{len(schema.modules)} module(s) detected — enable module filtering for per-module views.")
    if schema.date_range:
        recs.append(f"Data spans {schema.date_range[0]} → {schema.date_range[1]}; default range snaps to this.")
    return recs or ["Metrics fully backed by real data — ready to publish."]
