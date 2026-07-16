"""Agent 5 — Dashboard Planning (Gemini-driven, heuristic fallback).

The LLM proposes the layout/titles/recommendations, but every metric &
dimension it references is enforced against the discovered schema — so it can
reorganize and label, never invent data. If the LLM is unavailable or returns
nothing usable, a deterministic heuristic produces the same shape.
"""
from __future__ import annotations

import json

from ..llm import gemini_json, llm_available
from ..models import (
    DashboardFilter,
    DashboardRow,
    MetricType,
    NormalizedSchema,
    WidgetConfig,
    WidgetType,
)
from .base import LogFn

_ALLOWED_CHART = {"line_chart", "bar_chart", "donut", "histogram"}


async def run(schema: NormalizedSchema, log: LogFn) -> tuple[list[DashboardRow], list[DashboardFilter], list[str]]:
    metrics = {m.key: m for m in schema.metrics}

    plan = None
    if llm_available() and schema.metrics:
        plan = await _llm_plan(schema)
        if plan:
            await log("dashboard_planning", "info", "Gemini proposed the layout; validating against real metrics…")

    if plan:
        rows, filters, recs = _build_from_plan(plan, schema, metrics)
        if any(r.widgets for r in rows):
            await log("dashboard_planning", "success",
                      f"Gemini plan → {sum(len(r.widgets) for r in rows)} widget(s), {len(filters)} filter(s)")
            return rows, filters, recs
        await log("dashboard_planning", "warn", "Gemini plan had no valid widgets — using heuristic")

    rows, filters, recs = _heuristic(schema, metrics)
    await log("dashboard_planning", "success",
              f"Heuristic plan → {sum(len(r.widgets) for r in rows)} widget(s), {len(filters)} filter(s)")
    return rows, filters, recs


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
        "metrics": [{"key": m.key, "label": m.label, "type": m.type.value} for m in schema.metrics],
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
        if not m or m.type not in (MetricType.count, MetricType.score, MetricType.rate) or key in tile_keys:
            continue  # enforce: real metric only
        tile_keys.add(key)
        tiles.append(WidgetConfig(id=f"tile_{key}", type=WidgetType.kpi_tile, title=m.label,
                                  metric_key=key, source_kind=m.source_kind, source_action=m.source_action,
                                  raw_field=m.raw_field))
    # Gemini picks which tiles to feature/order, but every count/score/rate
    # metric that schema_discovery genuinely confirmed real (e.g. Sanfer's
    # certification stats) must still show up — an LLM's own summarization
    # picking "3-5 typical KPIs" is not grounds to silently drop a real one.
    for m in schema.metrics:
        if m.key in tile_keys or m.type not in (MetricType.count, MetricType.score, MetricType.rate):
            continue
        tile_keys.add(m.key)
        tiles.append(WidgetConfig(id=f"tile_{m.key}", type=WidgetType.kpi_tile, title=m.label,
                                  metric_key=m.key, source_kind=m.source_kind, source_action=m.source_action,
                                  raw_field=m.raw_field))

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
        # a chart must be backed by a real metric or a real dimension
        src_metric = metrics.get(mkey) if mkey in metrics else next(iter(schema.metrics), None)
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

    rows: list[DashboardRow] = []
    if tiles:
        rows.append(DashboardRow(id="row_kpis", title="Overview", widgets=tiles))
    if charts:
        rows.append(DashboardRow(id="row_charts", title="Analytics", widgets=charts))
    filters = _filters(schema)
    recs = [str(r) for r in plan.get("recommendations", []) if isinstance(r, str)][:6] or _recs(schema, metrics)
    return rows, filters, recs


def _auto_table_widgets(schema: NormalizedSchema) -> list[WidgetConfig]:
    return [
        WidgetConfig(id=f"table_{m.key}", type=WidgetType.table, title=m.label,
                     source_kind=m.source_kind, source_action=m.source_action, raw_field=m.raw_field, span=4)
        for m in schema.metrics if m.type == MetricType.table
    ]


# ── Heuristic fallback ─────────────────────────────────────────────────────────────
def _heuristic(schema: NormalizedSchema, metrics: dict):
    tiles = [WidgetConfig(id=f"tile_{m.key}", type=WidgetType.kpi_tile, title=m.label, metric_key=m.key,
                          source_kind=m.source_kind, source_action=m.source_action, raw_field=m.raw_field)
             for m in schema.metrics if m.type in (MetricType.count, MetricType.score, MetricType.rate)]
    charts: list[WidgetConfig] = []
    ts = next((m for m in schema.metrics if m.type == MetricType.timeseries), None)
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
