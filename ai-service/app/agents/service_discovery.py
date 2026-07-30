"""Agent 3 — Service Discovery.

Probe every connector for the company, concurrently, and record which services
are alive and which contain useful data. Deterministic (no LLM). Resolves the
real bridge slug from the candidate list along the way.
"""
from __future__ import annotations

import asyncio

from ..connectors import (
    CoachAppConnector,
    RolplayAppConnector,
    RolplayPharmaConnector,
    SecondBrainConnector,
)
from ..models import CompanyKnowledge, ServiceDescriptor
from ..util import candidate_slugs
from .base import LogFn


async def run(knowledge: CompanyKnowledge, exercise_ids: list[int], log: LogFn) -> CompanyKnowledge:
    if knowledge.source == "cache" and knowledge.services:
        await log("service_discovery", "info", f"{len(knowledge.services)} service(s) already known — skipping re-probe")
        return knowledge

    pharma = RolplayPharmaConnector()
    services: list[ServiceDescriptor] = []

    # 1) pharma bridge — try each candidate slug until one responds.
    #    If the manager didn't type exercise IDs, auto-fill known ones so
    #    exceltis/sale_exercises clients onboard with the company name alone.
    from ..known_tenants import known_ids_for
    resolved_slug = knowledge.slug
    for slug in candidate_slugs(knowledge.company):
        effective_ids = exercise_ids or known_ids_for(slug)
        if effective_ids and not exercise_ids:
            await log("service_discovery", "info", f"Auto-filled {len(effective_ids)} known exercise ID(s) for '{slug}'")
        # "Pharma bridge" is this connector's internal codename (first built
        # for pharma clients) — every industry uses the identical mechanism,
        # so the manager-facing message never says "pharma".
        await log("service_discovery", "info", f"Probing data source for '{slug}'…")
        svc = await pharma.probe(slug, effective_ids)
        if svc:
            services.append(svc)
            resolved_slug = slug
            if effective_ids:
                knowledge.exercise_ids = sorted(set(knowledge.exercise_ids) | set(effective_ids))
            await log("service_discovery", "success",
                      f"Found {svc.kind.value} at {svc.base_url} ({'has data' if svc.has_data else 'reachable'})")
            break
    knowledge.slug = resolved_slug

    # 2) other connectors, concurrently
    results = await asyncio.gather(
        RolplayAppConnector().probe(knowledge.company),
        CoachAppConnector().probe(knowledge.domains),
        SecondBrainConnector().probe(knowledge.domains),
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, ServiceDescriptor):
            services.append(r)
            await log("service_discovery", "success", f"Found {r.kind.value}: {r.note}")

    knowledge.services = services
    if not services:
        await log("service_discovery", "warn", "No live services found for this company")
    else:
        alive_with_data = [s for s in services if s.has_data]
        await log("service_discovery", "info",
                  f"{len(services)} service(s) alive, {len(alive_with_data)} with data")
    return knowledge


def pick_primary(knowledge: CompanyKnowledge) -> ServiceDescriptor | None:
    """The service the dashboard is primarily built from: prefer one with data.

    rolplay_app_sql now ranks ABOVE coach_app_sql, reversed from the previous
    order. Found live: Takeda's cached knowledge had picked coach_app_sql over
    rolplay_app_sql, and coach_app_sql's match came from a broad LIKE probe
    against coach_users on the email domain (CoachAppConnector.probe) -- a
    much weaker signal of "this is really the client's account" than
    rolplay_app_sql's match against r_client.name, which is where Takeda's
    real, verified account actually lives (client_id=13, confirmed against
    live production data this session). coach_app_sql is kept ABOVE
    second_brain, which is never the primary analytics source for any tenant.

    pharma_kpi/pharma_sale_exercises/pharma_exceltis_rest stay on top,
    unchanged -- those match on an explicit tenant slug (not a fuzzy domain or
    name LIKE), so they are a strictly stronger signal than either of the two
    reordered below them.
    """
    if not knowledge.services:
        return None
    with_data = [s for s in knowledge.services if s.has_data]
    pool = with_data or knowledge.services
    order = {
        "pharma_kpi": 0, "pharma_sale_exercises": 1, "pharma_exceltis_rest": 2,
        "rolplay_app_sql": 3, "coach_app_sql": 4, "second_brain": 5, "unknown": 9,
    }
    return sorted(pool, key=lambda s: order.get(s.kind.value, 9))[0]
