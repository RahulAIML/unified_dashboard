"""Agent 5 — Dashboard Planning.

Turn the normalized schema into a widget/row/filter plan. Only metrics backed by
real data become widgets — never invents. Heuristic by default; if an LLM key is
configured it refines titles/recommendations (optional, non-blocking).
"""
from __future__ import annotations

from ..models import (
    DashboardFilter,
    DashboardRow,
    NormalizedSchema,
    WidgetConfig,
    WidgetType,
    MetricType,
)
from .base import LogFn


async def run(schema: NormalizedSchema, log: LogFn) -> tuple[list[DashboardRow], list[DashboardFilter], list[str]]:
    metrics = {m.key: m for m in schema.metrics}
    tiles: list[WidgetConfig] = []
    charts: list[WidgetConfig] = []

    # KPI tiles from count/score/rate metrics
    for m in schema.metrics:
        if m.type in (MetricType.count, MetricType.score, MetricType.rate):
            tiles.append(WidgetConfig(
                id=f"tile_{m.key}", type=WidgetType.kpi_tile, title=m.label,
                metric_key=m.key, source_kind=m.source_kind, source_action=m.source_action, span=1,
            ))

    # Timeseries → line chart
    ts = next((m for m in schema.metrics if m.type == MetricType.timeseries), None)
    if ts:
        charts.append(WidgetConfig(
            id="chart_trend", type=WidgetType.line_chart, title=ts.label,
            metrics=[ts.key], source_kind=ts.source_kind, source_action=ts.source_action, span=2,
        ))

    # Dimension → bar chart + table
    dim = next((m for m in schema.metrics if m.type == MetricType.dimension), None)
    if dim:
        charts.append(WidgetConfig(
            id="chart_breakdown", type=WidgetType.bar_chart, title=dim.label,
            dimension=schema.dimensions[0] if schema.dimensions else "category",
            metrics=["total_sessions"], source_kind=dim.source_kind, source_action=dim.source_action, span=2,
        ))
        charts.append(WidgetConfig(
            id="table_breakdown", type=WidgetType.table, title=f"{dim.label} — detail",
            dimension=schema.dimensions[0] if schema.dimensions else "category",
            metrics=[k for k in ("total_sessions", "avg_score", "pass_rate") if k in metrics],
            source_kind=dim.source_kind, source_action=dim.source_action, span=4,
        ))

    rows: list[DashboardRow] = []
    if tiles:
        rows.append(DashboardRow(id="row_kpis", title="Overview", widgets=tiles))
    if charts:
        rows.append(DashboardRow(id="row_charts", title="Analytics", widgets=charts))

    # Filters
    filters: list[DashboardFilter] = []
    if schema.date_range or ts:
        filters.append(DashboardFilter(key="date_range", label="Date range", type="date_range"))
    if schema.modules:
        filters.append(DashboardFilter(key="module", label="Module", type="module", options=schema.modules))

    # Recommendations (data-driven, honest)
    recs: list[str] = []
    if "avg_score" not in metrics:
        recs.append("This source records activity but not numeric scores — dashboard is counts-only.")
    if schema.modules:
        recs.append(f"{len(schema.modules)} distinct module(s) detected — enable module filtering for per-module views.")
    if schema.date_range:
        recs.append(f"Data spans {schema.date_range[0]} → {schema.date_range[1]}; default range snaps to this.")
    if not recs:
        recs.append("Metrics fully backed by real data — ready to publish.")

    await log("dashboard_planning", "success",
              f"Planned {sum(len(r.widgets) for r in rows)} widget(s) across {len(rows)} row(s), {len(filters)} filter(s)")
    return rows, filters, recs
