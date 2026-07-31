"""Agent 6 — Dashboard Configuration.

Assemble the publishable DashboardConfig (pure metadata) from the plan + the
resolved connector. The Next.js app renders this dynamically; no React is
generated here.
"""
from __future__ import annotations

from ..models import (
    CompanyKnowledge,
    DashboardConfig,
    DashboardFilter,
    DashboardPage,
    NormalizedSchema,
    ServiceDescriptor,
)
from .base import LogFn


async def run(
    knowledge: CompanyKnowledge,
    schema: NormalizedSchema,
    service: ServiceDescriptor,
    pages: list[DashboardPage],
    filters: list[DashboardFilter],
    recommendations: list[str],
    log: LogFn,
) -> DashboardConfig:
    handle = dict(service.handle)
    # carry discovered ids so preview/publish can query without rediscovery
    handle["exercise_ids"] = knowledge.exercise_ids
    handle["coach_activity_ids"] = knowledge.coach_activity_ids
    if schema.date_range:
        handle["date_range"] = list(schema.date_range)

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
        branding={"primary_color": "#DC2626"},
        version=1,
    )
    await log("dashboard_config", "success",
              f"Built dashboard config '{config.title}' ({service.kind.value}) — {len(pages)} page(s)")
    return config
