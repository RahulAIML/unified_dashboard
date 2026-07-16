"""Pydantic domain models — the contracts every agent produces/consumes.

These are deliberately connector-agnostic: a "service" is any reachable data
capability, a "metric" is anything with a real value, a "widget" is pure
metadata. That is what lets the same pipeline extend from Rolplay's pharma
bridges to any REST/SQL/GraphQL source later without redesign.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Discovery ──────────────────────────────────────────────────────────────────

class ServiceKind(str, Enum):
    pharma_kpi = "pharma_kpi"
    pharma_sale_exercises = "pharma_sale_exercises"
    pharma_exceltis_rest = "pharma_exceltis_rest"
    coach_app_sql = "coach_app_sql"
    second_brain = "second_brain"
    rolplay_app_sql = "rolplay_app_sql"
    unknown = "unknown"


class ServiceDescriptor(BaseModel):
    """One discovered, reachable data capability for a company."""
    kind: ServiceKind
    name: str
    base_url: str
    alive: bool = False
    auth_ok: bool = True
    has_data: bool = False
    # Connector-specific handle (e.g. bridge tenant key, customer_id, client_id).
    handle: dict[str, Any] = Field(default_factory=dict)
    # Actions/endpoints observed to respond.
    endpoints: list[str] = Field(default_factory=list)
    note: str = ""


class CompanyKnowledge(BaseModel):
    """Everything known about a company — the persisted knowledge base entry."""
    company: str
    slug: str
    domains: list[str] = Field(default_factory=list)
    services: list[ServiceDescriptor] = Field(default_factory=list)
    exercise_ids: list[int] = Field(default_factory=list)
    coach_activity_ids: list[int] = Field(default_factory=list)
    last_discovery: datetime | None = None
    source: Literal["fresh", "cache"] = "fresh"
    note: str = ""


# ── Schema ──────────────────────────────────────────────────────────────────────

class MetricType(str, Enum):
    count = "count"        # session/record counts
    score = "score"        # 0-100 average
    rate = "rate"          # percentage (pass rate, engagement)
    dimension = "dimension"  # groupable label (activity, line, user)
    timeseries = "timeseries"
    table = "table"         # arbitrary row-shaped data (auto-discovered, generic columns)


class DiscoveredMetric(BaseModel):
    key: str
    label: str
    type: MetricType
    unit: str | None = None
    # The service + action that backs this metric (provenance = real data only).
    source_kind: ServiceKind
    source_action: str
    sample_value: Any | None = None
    supported: bool = True
    # Dotted path to the value within the action's real JSON response (e.g.
    # "certified" or "stats.avg_best_score" for a nested field, "data" for a
    # table's row list). Only set for auto-discovered metrics the pipeline has
    # never seen a hardcoded name for — known metrics resolve by metric_key
    # via dedicated code and leave this unset.
    raw_field: str | None = None


class NormalizedSchema(BaseModel):
    company: str
    slug: str
    metrics: list[DiscoveredMetric] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)  # simulator/coach/certification/...
    date_range: tuple[str, str] | None = None
    note: str = ""


# ── Dashboard config (metadata only — never React code) ─────────────────────────

class WidgetType(str, Enum):
    kpi_tile = "kpi_tile"
    line_chart = "line_chart"
    bar_chart = "bar_chart"
    donut = "donut"
    table = "table"
    histogram = "histogram"


class WidgetConfig(BaseModel):
    id: str
    type: WidgetType
    title: str
    metric_key: str | None = None
    # For charts/tables: which dimension to group by, which metrics to plot.
    dimension: str | None = None
    metrics: list[str] = Field(default_factory=list)
    source_kind: ServiceKind
    source_action: str
    span: int = 1  # grid columns (1-4)
    note: str = ""
    # See DiscoveredMetric.raw_field — carried through so the generic preview
    # fetcher can pull the right field from an auto-discovered action's response.
    raw_field: str | None = None


class DashboardRow(BaseModel):
    id: str
    title: str | None = None
    widgets: list[WidgetConfig] = Field(default_factory=list)


class DashboardFilter(BaseModel):
    key: str
    label: str
    type: Literal["date_range", "select", "module"]
    options: list[str] = Field(default_factory=list)


class DashboardConfig(BaseModel):
    """The publishable artifact. The Next.js app renders this dynamically."""
    company: str
    slug: str
    title: str
    connector: ServiceKind
    connector_handle: dict[str, Any] = Field(default_factory=dict)
    rows: list[DashboardRow] = Field(default_factory=list)
    filters: list[DashboardFilter] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    branding: dict[str, Any] = Field(default_factory=dict)
    version: int = 1
    created_at: datetime = Field(default_factory=_now)


# ── Validation ──────────────────────────────────────────────────────────────────

class ValidationSeverity(str, Enum):
    error = "error"
    warning = "warning"
    info = "info"


class ValidationIssue(BaseModel):
    severity: ValidationSeverity
    code: str
    message: str
    widget_id: str | None = None


class ValidationReport(BaseModel):
    ok: bool
    issues: list[ValidationIssue] = Field(default_factory=list)
    summary: str = ""

    @property
    def has_errors(self) -> bool:
        return any(i.severity == ValidationSeverity.error for i in self.issues)


# ── Preview ─────────────────────────────────────────────────────────────────────

class WidgetPreview(BaseModel):
    widget_id: str
    ok: bool
    value: Any | None = None
    series: list[dict[str, Any]] | None = None
    rows: list[dict[str, Any]] | None = None
    error: str | None = None


class DashboardPreview(BaseModel):
    slug: str
    widgets: list[WidgetPreview] = Field(default_factory=list)
    generated_at: datetime = Field(default_factory=_now)


# ── Jobs (long-running orchestration) ───────────────────────────────────────────

class JobPhase(str, Enum):
    queued = "queued"
    planning = "planning"
    company_discovery = "company_discovery"
    service_discovery = "service_discovery"
    # Paused: the connector was found, but no exercise/usecase IDs are known for
    # it (no cached knowledge, no known_tenants entry) and none were supplied.
    # Some bridges (sale_exercises/exceltis_rest) have NO endpoint that lists
    # valid IDs — the manager must provide them. The job waits here for
    # POST /ai/provide-ids rather than guessing or erroring.
    needs_ids = "needs_ids"
    schema_discovery = "schema_discovery"
    # Paused: schema discovery found the company's REAL modules/services
    # (e.g. "Coach maestro", "certification"). The manager reviews this exact
    # list and can deselect any before the dashboard is built — never asked to
    # pick blind, never shown something that isn't actually there.
    review_services = "review_services"
    dashboard_planning = "dashboard_planning"
    dashboard_config = "dashboard_config"
    validation = "validation"
    preview = "preview"
    publish = "publish"
    done = "done"
    error = "error"


class JobLog(BaseModel):
    ts: datetime = Field(default_factory=_now)
    phase: JobPhase
    level: Literal["info", "warn", "error", "success"] = "info"
    message: str


class GenerateRequest(BaseModel):
    company: str = Field(..., min_length=1)
    exercise_ids: list[int] = Field(default_factory=list)
    manager_request: str = ""
    auto_publish: bool = False


class JobState(BaseModel):
    job_id: str
    request: GenerateRequest
    phase: JobPhase = JobPhase.queued
    percent: int = 0
    logs: list[JobLog] = Field(default_factory=list)
    knowledge: CompanyKnowledge | None = None
    schema_: NormalizedSchema | None = Field(default=None, alias="schema")
    dashboard: DashboardConfig | None = None
    validation: ValidationReport | None = None
    preview: DashboardPreview | None = None
    published: bool = False
    error: str | None = None
    # Set while phase == needs_ids: which connector was found, so the resume
    # call can continue schema discovery with the manager-supplied IDs without
    # re-running company/service discovery from scratch.
    pending_connector: ServiceKind | None = None
    # Set while phase == review_services: the REAL modules schema discovery
    # found (e.g. ["Coach maestro", "Coach evaluador"]) — never invented,
    # always exactly what the connector reported. The manager's selection
    # (POST /ai/confirm-services) narrows schema.modules before planning runs.
    available_modules: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)

    model_config = {"populate_by_name": True}
