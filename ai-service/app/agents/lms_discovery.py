"""Agent — LMS Discovery (independent of the primary connector).

A real tenant's LMS (LearnWorlds) is gated purely on credential presence,
never on which analytics connector (pharma_kpi / rolplay_app_sql /
coach_app_sql) the tenant uses — a pharma tenant and a rolplay-app tenant can
each independently have their own LearnWorlds school. This mirrors that:
run as its OWN discovery step regardless of the primary connector's kind,
using the company's slug as the tenant_key -- the SAME key the Next.js app
resolves via resolvePharmaTenant()/resolveRolplayAppAccess(), and the SAME
key publish() already registers as pharma_tenants.tenant_key /
rolplay_app_domains.tenant_key.
"""
from __future__ import annotations

from .. import lms
from ..models import CompanyKnowledge, DiscoveredMetric, MetricType, NormalizedSchema, ServiceKind
from .base import LogFn


async def run(knowledge: CompanyKnowledge, schema: NormalizedSchema, log: LogFn) -> None:
    probe = await lms.lms_probe(knowledge.slug)
    if not probe["configured"]:
        return  # no LMS credentials for this tenant -- not an error, just absent
    if not probe["alive"]:
        await log("schema_discovery", "warn",
                  f"LMS credentials found for '{knowledge.company}' but the school is unreachable: {probe['note']}")
        return

    await log("schema_discovery", "success",
              f"LMS confirmed for '{knowledge.company}' — {probe['courses']} course(s)")

    schema.metrics.extend([
        DiscoveredMetric(key="lms_enrolled_users", label="Enrolled Users", type=MetricType.count,
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_completion_rate", label="Completion Rate", type=MetricType.rate, unit="%",
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_avg_quiz_score", label="Avg Quiz Score", type=MetricType.score, unit="pts",
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_modules_completed", label="Modules Completed", type=MetricType.count,
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_completion_trend", label="LMS Completions", type=MetricType.timeseries,
                         source_kind=ServiceKind.lms, source_action="lms.completion_trend"),
        DiscoveredMetric(key="lms_courses", label="Courses", type=MetricType.table,
                         source_kind=ServiceKind.lms, source_action="lms.courses"),
    ])
    if "lms" not in schema.modules:
        schema.modules.append("lms")
