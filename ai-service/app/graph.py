"""LangGraph orchestration of the agent pipeline.

Each node is one agent; the graph wires them in order with a conditional branch
that ends early if no live data service is found. Shares a mutable JobState +
update callback through the graph state so progress streams to the API exactly
as the sequential pipeline does. jobs.py runs this; workflow.py is the fallback.
"""
from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from .agents import (
    company_discovery,
    dashboard_config,
    dashboard_planning,
    planner,
    preview,
    publish,
    schema_discovery,
    service_discovery,
)
from .agents.service_discovery import pick_primary
from .knowledge import put_knowledge
from .models import JobLog, JobPhase, JobState, ServiceKind

# Bridges with no endpoint that lists valid exercise/usecase IDs — the manager
# must supply them once; there is no way to discover them live.
_NEEDS_IDS = {ServiceKind.pharma_sale_exercises, ServiceKind.pharma_exceltis_rest}


class GState(TypedDict, total=False):
    job: JobState
    update: Any
    knowledge: Any
    schema: Any
    primary: Any
    rows: Any
    filters: Any
    recs: Any
    cfg: Any


def _mk_log(state: GState):
    job: JobState = state["job"]
    update = state["update"]

    async def log(phase: str, level: str, message: str) -> None:
        job.logs.append(JobLog(phase=JobPhase(phase), level=level, message=message))
        await update(job)

    return log


async def _set(state: GState, phase: JobPhase, percent: int) -> None:
    state["job"].phase = phase
    state["job"].percent = percent
    await state["update"](state["job"])


async def n_plan(state: GState) -> dict:
    await _set(state, JobPhase.planning, 8)
    await planner.run(state["job"].request, _mk_log(state))
    return {}


async def n_company(state: GState) -> dict:
    await _set(state, JobPhase.company_discovery, 18)
    req = state["job"].request
    k = await company_discovery.run(req.company, req.exercise_ids, _mk_log(state), getattr(req, "domains", None))
    state["job"].knowledge = k
    return {"knowledge": k}


async def n_service(state: GState) -> dict:
    await _set(state, JobPhase.service_discovery, 38)
    k = await service_discovery.run(state["knowledge"], state["job"].request.exercise_ids, _mk_log(state))
    state["job"].knowledge = k
    return {"knowledge": k, "primary": pick_primary(k)}


async def n_schema(state: GState) -> dict:
    await _set(state, JobPhase.schema_discovery, 55)
    schema = await schema_discovery.run(state["knowledge"], state["primary"], state["job"].request.exercise_ids, _mk_log(state))
    state["job"].schema_ = schema
    await put_knowledge(state["knowledge"])
    return {"schema": schema}


async def n_needs_ids(state: GState) -> dict:
    job = state["job"]
    primary = state["primary"]
    job.phase = JobPhase.needs_ids
    job.pending_connector = primary.kind
    job.percent = 40
    await _mk_log(state)("service_discovery", "info",
                         f"Found {primary.kind.value} for '{job.request.company}', but this bridge has no way to "
                         "list its own exercise/usecase IDs — please provide them to continue.")
    await state["update"](job)
    return {}


async def n_review_services(state: GState) -> dict:
    job = state["job"]
    schema = state["schema"]
    job.phase = JobPhase.review_services
    job.available_modules = list(schema.modules)
    job.percent = 60
    await _mk_log(state)("schema_discovery", "info",
                         f"Found {len(schema.modules)} real module(s): {', '.join(schema.modules)}. "
                         "Review and confirm which to include.")
    await state["update"](job)
    return {}


async def n_planning(state: GState) -> dict:
    await _set(state, JobPhase.dashboard_planning, 68)
    rows, filters, recs = await dashboard_planning.run(state["schema"], _mk_log(state))
    return {"rows": rows, "filters": filters, "recs": recs}


async def n_config(state: GState) -> dict:
    await _set(state, JobPhase.dashboard_config, 76)
    cfg = await dashboard_config.run(state["knowledge"], state["schema"], state["primary"],
                                     state["rows"], state["filters"], state["recs"], _mk_log(state))
    cfg.connector_handle["base_url"] = state["primary"].base_url
    state["job"].dashboard = cfg
    return {"cfg": cfg}


async def n_validation(state: GState) -> dict:
    await _set(state, JobPhase.validation, 84)
    from .agents import validation
    report = await validation.run(state["cfg"], state["schema"], state["primary"], _mk_log(state))
    state["job"].validation = report
    return {}


async def n_preview(state: GState) -> dict:
    await _set(state, JobPhase.preview, 95)
    pv = await preview.run(state["cfg"], _mk_log(state))
    state["job"].preview = pv
    return {}


async def n_publish(state: GState) -> dict:
    job = state["job"]
    if job.request.auto_publish and job.validation and job.validation.ok:
        await _set(state, JobPhase.publish, 98)
        job.published = await publish.run(state["cfg"], state["knowledge"].domains, _mk_log(state))
    return {}


async def n_done(state: GState) -> dict:
    job = state["job"]
    job.phase = JobPhase.done
    job.percent = 100
    await _mk_log(state)("done", "success", f"Dashboard generated for '{job.request.company}'. Review and publish.")
    await state["update"](job)
    return {}


async def n_no_service(state: GState) -> dict:
    job = state["job"]
    job.phase = JobPhase.error
    job.error = f"No live data service found for '{job.request.company}'."
    # This is a genuine "nobody's built this yet" case, not a bug — surface a
    # concrete developer handoff instead of a bare failure, since fixing it
    # means writing a new bridge endpoint outside this app, which no agent
    # here has credentials or scope to do safely on its own.
    await _mk_log(state)("error", "error",
        f"{job.error} Tried every known domain/bridge-kind pattern for this company and found nothing live. "
        "This company's raw training data likely isn't wired to any bridge endpoint yet — that's a one-time "
        "backend task, not something this pipeline can create on its own (it only reads existing bridges, never "
        "writes new backend code or touches production databases directly). To onboard this company: a developer "
        "needs to (1) find which database/table holds their practice-session records, (2) add a bridge endpoint "
        "following the same {action, ...} JSON-dispatch protocol every other tenant uses (see any existing bridge "
        "as a reference), then (3) re-run this generator — discovery, schema understanding, KPI selection, and "
        "publishing all still happen automatically from there.")
    await state["update"](job)
    return {}


def _after_service(state: GState) -> str:
    primary = state.get("primary")
    if not primary:
        return "no_service"
    knowledge = state.get("knowledge")
    has_ids = bool(knowledge and knowledge.exercise_ids)
    if primary.kind in _NEEDS_IDS and not has_ids:
        return "needs_ids"
    return "schema"


def _after_schema(state: GState) -> str:
    schema = state.get("schema")
    return "review_services" if schema and schema.modules else "planning"


def build_graph():
    g = StateGraph(GState)
    for name, fn in [
        ("plan", n_plan), ("company", n_company), ("service", n_service),
        ("discover_schema", n_schema), ("planning", n_planning), ("config", n_config),
        ("validation", n_validation), ("preview", n_preview), ("publish", n_publish),
        ("done", n_done), ("no_service", n_no_service),
        ("needs_ids", n_needs_ids), ("review_services", n_review_services),
    ]:
        g.add_node(name, fn)
    g.add_edge(START, "plan")
    g.add_edge("plan", "company")
    g.add_edge("company", "service")
    g.add_conditional_edges("service", _after_service,
                            {"schema": "discover_schema", "no_service": "no_service", "needs_ids": "needs_ids"})
    g.add_conditional_edges("discover_schema", _after_schema,
                            {"planning": "planning", "review_services": "review_services"})
    g.add_edge("planning", "config")
    g.add_edge("config", "validation")
    g.add_edge("validation", "preview")
    g.add_edge("preview", "publish")
    g.add_edge("publish", "done")
    g.add_edge("done", END)
    g.add_edge("no_service", END)
    g.add_edge("needs_ids", END)
    g.add_edge("review_services", END)
    return g.compile()


_GRAPH = None


async def run_generation_graph(job: JobState, update) -> None:
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_graph()
    await _GRAPH.ainvoke({"job": job, "update": update})
