"""Agent 6 — Dashboard Configuration.

Assemble the publishable DashboardConfig (pure metadata) from the plan + the
resolved connector. The Next.js app renders this dynamically; no React is
generated here.
"""
from __future__ import annotations

from ..branding_lookup import lookup_tenant_branding
from ..models import (
    CompanyKnowledge,
    DashboardConfig,
    DashboardFilter,
    DashboardPage,
    NormalizedSchema,
    ServiceDescriptor,
)
from .base import LogFn

_DEFAULT_BRANDING = {"primary_color": "#DC2626"}


async def run(
    knowledge: CompanyKnowledge,
    schema: NormalizedSchema,
    service: ServiceDescriptor,
    pages: list[DashboardPage],
    filters: list[DashboardFilter],
    recommendations: list[str],
    log: LogFn,
    secondary: ServiceDescriptor | None = None,
    required_services: frozenset[str] = frozenset(),
) -> DashboardConfig:
    handle = dict(service.handle)
    # carry discovered ids so preview/publish can query without rediscovery
    handle["exercise_ids"] = knowledge.exercise_ids
    handle["coach_activity_ids"] = knowledge.coach_activity_ids
    if schema.date_range:
        handle["date_range"] = list(schema.date_range)
    if secondary:
        # Merge the secondary connector's OWN handle (e.g. coach_app_sql's
        # customer_id) in alongside the primary's, so preview_fetch.py can
        # resolve secondary-page widgets too. Safe to merge flat: every
        # connector kind uses its own distinct key names (client_id vs
        # customer_id vs tenant), so this can never silently overwrite one of
        # the primary's values with the secondary's.
        for key, value in secondary.handle.items():
            handle.setdefault(key, value)

    branding = dict(_DEFAULT_BRANDING)
    real_branding = await lookup_tenant_branding(knowledge.domains)
    if real_branding:
        branding.update({k: v for k, v in real_branding.items() if v})
        await log("dashboard_config", "info", "Using this tenant's saved branding instead of the default.")

    config = DashboardConfig(
        company=knowledge.company,
        slug=knowledge.slug,
        title=f"{knowledge.company} Analytics",
        connector=service.kind,
        connector_handle=handle,
        # `rows` stays populated (Overview's rows = pages[0]) so any consumer
        # still reading the old flat field keeps working unchanged; `pages`
        # is the new, real multi-page structure.
        rows=pages[0].rows if pages else [],
        pages=pages,
        filters=filters,
        recommendations=recommendations,
        branding=branding,
        version=1,
        required_sections=sorted(required_services),
    )
    await log("dashboard_config", "success",
              f"Built dashboard config '{config.title}' ({service.kind.value}) — {len(pages)} page(s)")
    return config
