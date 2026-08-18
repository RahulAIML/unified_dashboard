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
    # LearnWorlds LMS — gated purely on credential presence (app/lms.py),
    # never on which analytics connector (pharma_kpi/rolplay_app_sql/
    # coach_app_sql) a tenant uses. A tenant can independently have its own
    # LearnWorlds school regardless of primary connector, exactly like the
    # real Next.js app's hasLmsCredentialsAsync gate is independent of orgType.
    lms = "lms"
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


class ConfidenceLevel(str, Enum):
    """How sure the pipeline is that a discovered capability means what it
    claims to mean — never invented, always tied to a concrete evidence
    string. 'verified' means the mapping itself is exact and tested (e.g.
    rolplay_app_sql's r_simulator.category -> canonical module map);
    'probable' means a real match on weaker signal (e.g. a domain-LIKE
    match rather than an exact name match); 'unverified' means real data
    was found but nothing confirms what business concept it represents.
    Never used to gate whether data is INCLUDED (has_data already does
    that) — only to say how much a human should trust the SEMANTIC label
    the pipeline put on it.
    """
    verified = "verified"
    probable = "probable"
    unverified = "unverified"


class Capability(BaseModel):
    """One discovered business capability — the semantic-layer replacement
    for a bare 'modules: list[str]' string. Scoped to rolplay_app_sql only
    for now (see schema_discovery.py's _rolplay_app_schema): that's the one
    connector whose module mapping (r_simulator.category ->
    canonical name, via journey.py's CATEGORY_TO_MODULE) is exact and
    verified, never guessed. Other connectors continue to populate
    NormalizedSchema.modules as before, unchanged, and leave `capabilities`
    empty -- this is additive metadata, not a replacement for anything
    those connectors already do.
    """
    business_concept: str  # human name, e.g. "Coach Training", "Practice Simulation"
    module: str | None = None  # canonical module key, if this maps to one
    confidence: ConfidenceLevel
    evidence: str  # why this confidence level, in plain language


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
    # The real business question this KPI answers, in plain language (e.g.
    # "How many practice sessions have reps completed?"). Populated only
    # for rolplay_app_sql today (schema_discovery.py's _rolplay_app_schema)
    # -- optional and unset for every other connector, exactly like
    # raw_field's rollout pattern.
    business_question: str | None = None


class NormalizedSchema(BaseModel):
    company: str
    slug: str
    metrics: list[DiscoveredMetric] = Field(default_factory=list)
    dimensions: list[str] = Field(default_factory=list)
    modules: list[str] = Field(default_factory=list)  # simulator/coach/certification/...
    # Semantic-layer form of `modules` — see Capability's docstring. Empty
    # for every connector except rolplay_app_sql today; `modules` keeps
    # working exactly as before for everyone, this is purely additive.
    capabilities: list[Capability] = Field(default_factory=list)
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
    journey = "journey"


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
    # Canonical module name ('coach'/'simulator'/'certification') this widget
    # is scoped to — set only for per-module page widgets (dashboard_planning.py's
    # per-module pages), so preview_fetch.py can filter the underlying query to
    # just that module instead of the connector's full aggregate. None means
    # unscoped (every existing widget, and Overview-page widgets).
    module: str | None = None
    # For a table widget only: the key within each returned row that is a
    # real, click-through-able report id (e.g. "saved_report_id") — the
    # Next.js app's own /drilldown/[id] page already exists and resolves an
    # id server-side, scoped to the VIEWER's own tenant, for any id from a
    # connector with a verified matching drilldown backend (see
    # dashboard_planning.py's _auto_drilldown_table). None means this
    # table's rows have no drillable id (every widget before this one).
    id_field: str | None = None
    # See DiscoveredMetric.business_question — carried onto the widget so
    # the renderer/API can surface it without re-joining back to the
    # schema. Unset for every widget before this (rollout: rolplay_app_sql
    # only, via dashboard_planning.py's report/business-question wiring).
    business_question: str | None = None
    # Reports-page table widgets only (dashboard_planning.py's
    # _reports_page): real pagination/search/CSV-export, distinct from the
    # small capped drilldown table (_auto_drilldown_table), which lists at
    # most 50 rows with no search. False for every existing widget.
    paginated: bool = False
    searchable: bool = False
    exportable: bool = False
    # A section the manager explicitly contracted/requested (see
    # GenerateRequest.services) that must still render even though no data
    # was discovered for it — an honest "no data yet" empty state, never a
    # silent disappearance. False for every widget built from real discovered
    # data (the overwhelming majority).
    mandatory: bool = False


class DashboardRow(BaseModel):
    id: str
    title: str | None = None
    widgets: list[WidgetConfig] = Field(default_factory=list)


class DashboardPage(BaseModel):
    """One navigable page of the generated dashboard (Overview/LMS/Coach/...).
    Added so the AI builder can produce a real multi-page application instead
    of one flat scrolling page — the reference (hand-built) dashboard has ~10
    distinct pages; before this, every AI-generated dashboard had exactly one.
    """
    id: str
    title: str
    rows: list[DashboardRow] = Field(default_factory=list)
    # Permissions plumbing: which viewers this page is shown to. Only two
    # roles exist anywhere in this system today (lib/auth-types.ts: 'user'
    # | 'admin' — confirmed by direct search, no manager/rep role model
    # exists), so this stays a plain two-way switch rather than a fabricated
    # RBAC hierarchy. Every page defaults to "all_users" — nothing is
    # hidden by default; this proves the enforcement path works without
    # inventing a restriction nobody asked for.
    visibility: Literal["all_users", "admin_only"] = "all_users"
    # Same contract as WidgetConfig.mandatory, at the page level: a whole
    # page (e.g. "LMS") that the manager contracted but that has no
    # discovered data still appears, with an honest empty state, instead of
    # being omitted from `pages` entirely.
    mandatory: bool = False


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
    # DEPRECATED but kept for backward compatibility with any consumer reading
    # `rows` directly — always populated as the Overview page's rows (pages[0]
    # when pages is non-empty). New code should read `pages`.
    rows: list[DashboardRow] = Field(default_factory=list)
    # New: real multi-page structure. Empty for any config built before this
    # field existed (old JSONB rows in dashboard_metadata deserialize fine —
    # Pydantic defaults this to [] and DashboardRenderer.tsx falls back to
    # rendering `rows` flat when `pages` is empty).
    pages: list[DashboardPage] = Field(default_factory=list)
    filters: list[DashboardFilter] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    # Narrative, evidence-backed insight sentences generated from the
    # ACTUAL fetched preview data (agents/insights.py) — distinct from
    # `recommendations`, which are short actionable suggestions derived
    # from the schema alone, before any real values are fetched. Empty
    # when there's too little data to say anything grounded (never
    # fabricated to fill the space). rolplay_app_sql only, for now.
    insights: list[str] = Field(default_factory=list)
    branding: dict[str, Any] = Field(default_factory=dict)
    version: int = 1
    created_at: datetime = Field(default_factory=_now)
    # Closing criterion: set by an admin before sharing a published link
    # outside the normal authenticated tenant flow. Defaults False so every
    # config built before this field existed deserializes unchanged.
    confidential: bool = False
    # The contracted-services snapshot (GenerateRequest.services) this config
    # was last built/edited with — which page ids are allowed to render as a
    # mandatory empty state rather than disappearing. Persisted so a later
    # edit (POST /ai/dashboard/{slug}/required-sections) can add/remove a
    # required section without re-running discovery/planning from scratch.
    required_sections: list[str] = Field(default_factory=list)


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
    # Period-over-period comparison (kpi_tile only, rolplay_app_sql only for
    # now — see preview_fetch.py's _rolplay_app) — mirrors
    # rolplayAppOverview's prevTotalEvaluations/prevAvgScore/prevPassRate and
    # lib/kpi-builder.ts's calcDeltaPct exactly, so the AI-generated
    # dashboard shows the same "vs previous period" the hand-built one does.
    # None for every widget that doesn't compute a previous-period baseline.
    prev_value: Any | None = None
    delta_pct: float | None = None


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
    # Optional manager-provided email domain(s), e.g. "sanfer.com.mx". When set,
    # these seed login-routing directly instead of relying on a guess derived
    # from the company name — the guess is often wrong (e.g. "sanfer.com" when
    # reps are actually on "sanfer.com.mx"), which silently breaks logins.
    domains: list[str] = Field(default_factory=list)
    # Services the client has CONTRACTED (guided config step 1): simulator,
    # coach, certification, lms, second-brain. Empty = no restriction.
    #
    # A contracted service is MANDATORY: it always gets a page, even with zero
    # data, rendered as an honest empty state rather than fabricated zeros. See
    # agents/dashboard_planning.py::mandatory_empty_page and the fallbacks in
    # _lms_page / _module_pages / _assemble_pages.
    #
    # (This comment previously documented the opposite, older rule --
    # "contracted ∩ has-data = rendered", i.e. hide a contracted-but-empty
    # service. That rule no longer exists; silently dropping a section the
    # client is paying for is precisely what the mandatory design prevents.)
    services: list[str] = Field(default_factory=list)
    manager_request: str = ""
    auto_publish: bool = False
    # Post-launch layout freeze override: once a slug is published, a second
    # generate+auto_publish call for the SAME slug is blocked (see
    # agents/publish.py) unless a human explicitly sets this — an accidental
    # re-run of the builder must never silently rearrange what a client
    # already sees. Defaults False (frozen).
    force_republish: bool = False
    # Closing criterion: shown as a "CONFIDENTIAL" label on the published
    # /d/[slug] view -- for a link shared before the client's own login is
    # set up, or shared outside the platform entirely.
    confidential: bool = False


class JobState(BaseModel):
    job_id: str
    request: GenerateRequest
    phase: JobPhase = JobPhase.queued
    percent: int = 0
    logs: list[JobLog] = Field(default_factory=list)
    knowledge: CompanyKnowledge | None = None
    schema_: NormalizedSchema | None = Field(default=None, alias="schema")
    # A second alive-with-data connector's own schema (agents/service_discovery.py's
    # pick_secondary) -- e.g. Besins' 17 real coach_app_sql sessions, found
    # alongside the rolplay_app_sql primary. Composed into its own page rather
    # than silently dropped. None for the overwhelming majority of tenants
    # (only one connector matches). Persisted here (not just a local variable
    # in workflow.py) so it survives the review_services pause/resume, exactly
    # like schema_ does for the primary.
    secondary_schema: NormalizedSchema | None = None
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
