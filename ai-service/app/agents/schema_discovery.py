"""Agent 4 — Schema Discovery.

Read real API responses from the primary service and produce normalized
metadata: metrics (only those backed by real values), dimensions, modules,
exercise ids and the data date-range. Nothing hardcoded per company.
"""
from __future__ import annotations

from ..config import get_settings
from ..http import get_json, post_json
from ..rolplay_score import score_stats_inner
from ..models import (
    CompanyKnowledge,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceDescriptor,
    ServiceKind,
)
from .base import LogFn


async def run(knowledge: CompanyKnowledge, service: ServiceDescriptor, exercise_ids: list[int], log: LogFn) -> NormalizedSchema:
    schema = NormalizedSchema(company=knowledge.company, slug=knowledge.slug)
    kind = service.kind
    await log("schema_discovery", "info", f"Reading schema from {kind.value}…")

    if kind == ServiceKind.pharma_kpi:
        await _kpi_schema(knowledge, service, schema, log)
    elif kind == ServiceKind.pharma_sale_exercises:
        await _sale_exercises_schema(knowledge, service, schema, exercise_ids, log)
    elif kind == ServiceKind.pharma_exceltis_rest:
        await _exceltis_schema(knowledge, service, schema, exercise_ids, log)
    elif kind == ServiceKind.rolplay_app_sql:
        await _rolplay_app_schema(service, schema, log)
    elif kind == ServiceKind.second_brain:
        _second_brain_schema(service, schema)
    elif kind == ServiceKind.coach_app_sql:
        _analytics_schema(service, schema)

    await log("schema_discovery", "success",
              f"{len(schema.metrics)} metric(s), {len(schema.dimensions)} dimension(s), modules={schema.modules or '—'}")
    return schema


# ── pharma kpi (self-describing) ────────────────────────────────────────────────
async def _kpi_schema(k: CompanyKnowledge, svc: ServiceDescriptor, schema: NormalizedSchema, log: LogFn) -> None:
    s = get_settings()
    slug = svc.handle.get("tenant", k.slug)
    status, body = await post_json(
        svc.base_url,
        {"action": "kpi.activity_summary", "date_from": s.discovery_wide_date_from, "date_to": s.discovery_wide_date_to},
        headers={"X-Tenant": slug},
    )
    activities = (body or {}).get("activities", []) if isinstance(body, dict) else []
    activities = [a for a in activities if int(a.get("sessions") or 0) > 0]

    usecase_ids = sorted({int(a["usecase_id"]) for a in activities if a.get("usecase_id") is not None})
    activity_ids = sorted({int(a["activity_id"]) for a in activities if a.get("activity_id") is not None})
    coach_ids = sorted({int(a["activity_id"]) for a in activities if "maestro" in str(a.get("activity_type", "")).lower()})
    modules = sorted({str(a.get("activity_type")) for a in activities if a.get("activity_type")})

    k.exercise_ids = sorted(set(k.exercise_ids) | set(usecase_ids))
    k.coach_activity_ids = coach_ids
    schema.dimensions = ["activity", "activity_type", "user"]
    schema.modules = modules
    schema.metrics = [
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=svc.kind, source_action="kpi.overview"),
        DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score, unit="pts",
                         source_kind=svc.kind, source_action="kpi.overview"),
        DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate, unit="%",
                         source_kind=svc.kind, source_action="kpi.overview"),
        DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                         source_kind=svc.kind, source_action="kpi.activity_summary"),
        DiscoveredMetric(key="score_trend", label="Score Trend", type=MetricType.timeseries,
                         source_kind=svc.kind, source_action="kpi.score_trend"),
    ]
    await _kpi_daterange(svc, slug, schema, log)


async def _kpi_daterange(svc: ServiceDescriptor, slug: str, schema: NormalizedSchema, log: LogFn) -> None:
    status, body = await post_json(
        svc.base_url,
        {"action": "kpi.score_trend", "date_from": "2015-01-01", "date_to": "2035-12-31", "granularity": "month"},
        headers={"X-Tenant": slug},
    )
    trend = (body or {}).get("trend", []) if isinstance(body, dict) else []
    periods = sorted(p["period"] for p in trend if int(p.get("sessions") or 0) > 0 and p.get("period"))
    if periods:
        schema.date_range = (f"{periods[0]}-01", f"{periods[-1]}-28")


# ── pharma sale_exercises ────────────────────────────────────────────────────────
async def _sale_exercises_schema(k, svc, schema, exercise_ids, log) -> None:
    ids = exercise_ids or k.exercise_ids
    schema.dimensions = ["usecase", "user"]
    schema.metrics = [
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=svc.kind, source_action="sim.demorp6"),
        DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score, unit="pts",
                         source_kind=svc.kind, source_action="sim.demorp6"),
        DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate, unit="%",
                         source_kind=svc.kind, source_action="sim.demorp6"),
    ]
    # certification is a genuinely separate source when the bridge exposes it
    if any(a.startswith("cert.") for a in svc.endpoints):
        schema.modules.append("certification")
        schema.metrics.append(DiscoveredMetric(
            key="certified", label="Certified", type=MetricType.count,
            source_kind=svc.kind, source_action="cert.stats"))
    if not ids:
        await log("schema_discovery", "warn",
                  "sale_exercises needs exercise IDs — provide them for full metrics")


# ── pharma exceltis_rest ─────────────────────────────────────────────────────────
async def _exceltis_schema(k, svc, schema, exercise_ids, log) -> None:
    ids = exercise_ids or k.exercise_ids
    schema.dimensions = ["usecase", "user"]
    has_numeric_score = False
    if ids:
        s = get_settings()
        q = "&".join(f"id={i}" for i in ids)
        status, rows = await get_json(
            f"{svc.base_url}/api/rol_play_sim_extractor?{q}&fecha_inicio={s.discovery_wide_date_from}&fecha_fin={s.discovery_wide_date_to}"
        )
        if isinstance(rows, list) and rows:
            has_numeric_score = any(_is_number(r.get("Calificacion")) for r in rows[:50])
    schema.metrics = [DiscoveredMetric(
        key="total_sessions", label="Total Sessions", type=MetricType.count,
        source_kind=svc.kind, source_action="/api/rol_play_sim_extractor")]
    if has_numeric_score:
        schema.metrics += [
            DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score, unit="pts",
                             source_kind=svc.kind, source_action="/api/rol_play_sim_extractor"),
            DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate, unit="%",
                             source_kind=svc.kind, source_action="/api/rol_play_sim_extractor"),
        ]
    else:
        schema.note = "No numeric score in this client's data — counts-only."
        await log("schema_discovery", "info", "This client records qualitative results — counts-only dashboard")


async def _rolplay_app_schema(svc, schema, log: LogFn) -> None:
    """Rolplay-app clients: always counts; add score metrics when the client's
    sessions actually carry a score (raw_closing_data / closing_analysis), probed
    live so the dashboard represents everything the data has — client_id only."""
    schema.dimensions = ["simulator", "user"]
    metrics = [
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=svc.kind, source_action="r_user_session"),
        DiscoveredMetric(key="total_users", label="Active Users", type=MetricType.count,
                         source_kind=svc.kind, source_action="r_user"),
    ]

    client_id = int((svc.handle or {}).get("client_id") or 0)
    scored = 0
    if client_id:
        status, body = await post_json(
            get_settings().rolplay_app_sql_url,
            {"sql": f"SELECT COUNT(sc) AS scored FROM ({score_stats_inner(client_id)}) t"},
        )
        data = (body or {}).get("data") if isinstance(body, dict) else None
        if data:
            scored = int(data[0].get("scored") or 0)

    if scored > 0:
        metrics += [
            DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score, unit="pts",
                             source_kind=svc.kind, source_action="r_user_session"),
            DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate, unit="%",
                             source_kind=svc.kind, source_action="r_user_session"),
            # A timeseries metric makes the planner emit a trend line_chart; a
            # dimension metric makes it emit a per-simulator breakdown + table.
            DiscoveredMetric(key="score_trend", label="Score Trend", type=MetricType.timeseries, unit="pts",
                             source_kind=svc.kind, source_action="r_user_session"),
            DiscoveredMetric(key="by_simulator", label="By Simulator", type=MetricType.dimension,
                             source_kind=svc.kind, source_action="r_user_session"),
        ]
        schema.note = f"Rolplay-app platform: {scored} scored session(s) (score from raw_closing_data/closing_analysis)."
        await log("schema_discovery", "success", f"Scores available — {scored} scored session(s); trend + breakdown enabled")
    else:
        schema.note = "Rolplay-app platform: sessions recorded, no scores found — counts-only."
        await log("schema_discovery", "info", "No scores in this client's sessions — counts-only dashboard")

    schema.metrics = metrics


def _second_brain_schema(svc, schema) -> None:
    schema.modules = ["second-brain"]
    schema.dimensions = ["member", "role"]
    schema.metrics = [
        DiscoveredMetric(key="coaching_sessions", label="Coaching Sessions", type=MetricType.count,
                         source_kind=svc.kind, source_action="/organizations/full-profile"),
        DiscoveredMetric(key="total_members", label="Members", type=MetricType.count,
                         source_kind=svc.kind, source_action="/organizations/full-profile"),
        DiscoveredMetric(key="message_logs", label="Messages", type=MetricType.count,
                         source_kind=svc.kind, source_action="/organizations/full-profile"),
        DiscoveredMetric(key="engagement", label="Engagement", type=MetricType.rate, unit="%",
                         source_kind=svc.kind, source_action="/organizations/full-profile"),
    ]


def _analytics_schema(svc, schema) -> None:
    schema.dimensions = ["usecase", "user"]
    schema.metrics = [
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=svc.kind, source_action="report_field_current"),
        DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score, unit="pts",
                         source_kind=svc.kind, source_action="report_field_current"),
        DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate, unit="%",
                         source_kind=svc.kind, source_action="report_field_current"),
    ]


def _is_number(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False
