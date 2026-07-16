"""Orchestration — runs the agent pipeline and streams progress into a JobState.

The agents are independent async functions (nodes); this module wires them in
order and manages phase/percent/logs. A LangGraph StateGraph view of the same
nodes lives in graph.py (formal graph); this pipeline is the runtime the API
uses so it works with or without langgraph installed.

Two points can PAUSE the pipeline rather than run straight through, because
correctness requires a manager decision, not a guess:
  - needs_ids: the chosen connector has no endpoint that lists its own valid
    exercise/usecase IDs (true of sale_exercises/exceltis_rest bridges) and
    none are already known. Resume via resume_with_ids().
  - review_services: schema discovery found the company's REAL modules
    (never invented) and the manager reviews/narrows them before the
    dashboard is built. Resume via resume_with_services().
"""
from __future__ import annotations

from .agents import (
    auto_discovery,
    company_discovery,
    dashboard_config,
    dashboard_planning,
    planner,
    preview,
    publish,
    schema_discovery,
    service_discovery,
    validation,
)
from .agents.service_discovery import pick_primary
from .knowledge import put_knowledge
from .models import JobPhase, JobState, NormalizedSchema, ServiceDescriptor, ServiceKind

# Bridges with no endpoint that lists valid exercise/usecase IDs — the manager
# must supply them once; there is no way to discover them live.
_NEEDS_IDS = {ServiceKind.pharma_sale_exercises, ServiceKind.pharma_exceltis_rest}


def _mk_log(job: JobState, update):
    async def log(phase: str, level: str, message: str) -> None:
        from .models import JobLog, JobPhase as JP
        job.logs.append(JobLog(phase=JP(phase), level=level, message=message))  # type: ignore[arg-type]
        await update(job)
    return log


async def run_generation(job: JobState, update) -> None:
    """Full run from scratch: planning → …→ (pause points) → …→ preview/publish."""
    req = job.request
    log = _mk_log(job, update)

    try:
        job.phase = JobPhase.planning; job.percent = 2; await update(job)
        await planner.run(req, log)
        job.percent = 8; await update(job)

        job.phase = JobPhase.company_discovery; await update(job)
        knowledge = await company_discovery.run(req.company, req.exercise_ids, log)
        job.knowledge = knowledge; job.percent = 18; await update(job)

        job.phase = JobPhase.service_discovery; await update(job)
        knowledge = await service_discovery.run(knowledge, req.exercise_ids, log)
        job.knowledge = knowledge; job.percent = 38; await update(job)
        primary = pick_primary(knowledge)
        if not primary:
            job.phase = JobPhase.error; job.error = f"No live data service found for '{req.company}'."
            await log("error", "error", job.error); await update(job); return

        if primary.kind in _NEEDS_IDS and not knowledge.exercise_ids:
            job.phase = JobPhase.needs_ids
            job.pending_connector = primary.kind
            job.percent = 40
            await log("service_discovery", "info",
                      f"Found {primary.kind.value} for '{req.company}', but this bridge has no way to list its "
                      "own exercise/usecase IDs — please provide them to continue.")
            await update(job)
            return  # paused — resumed via resume_with_ids()

        await _continue_from_schema_discovery(job, knowledge, primary, update, log)
    except Exception as exc:  # noqa: BLE001
        job.phase = JobPhase.error; job.error = str(exc)[:300]
        await log("error", "error", job.error); await update(job)


async def resume_with_ids(job: JobState, exercise_ids: list[int], update) -> None:
    """Resume a job paused at needs_ids, now with manager-supplied IDs."""
    log = _mk_log(job, update)
    try:
        job.request.exercise_ids = exercise_ids
        knowledge = job.knowledge
        if knowledge is None:
            job.phase = JobPhase.error; job.error = "Cannot resume: no discovery state on this job."
            await log("error", "error", job.error); await update(job); return

        knowledge.exercise_ids = sorted(set(knowledge.exercise_ids) | set(exercise_ids))
        await log("service_discovery", "success", f"Received {len(exercise_ids)} exercise ID(s) — continuing…")

        # Re-resolve primary using the connector already found for this slug —
        # no need to re-probe every connector again.
        primary = next((s for s in knowledge.services if s.kind == job.pending_connector), None) or pick_primary(knowledge)
        if not primary:
            job.phase = JobPhase.error; job.error = "Cannot resume: the previously found connector is no longer available."
            await log("error", "error", job.error); await update(job); return

        job.pending_connector = None
        job.percent = 42
        await update(job)
        await _continue_from_schema_discovery(job, knowledge, primary, update, log)
    except Exception as exc:  # noqa: BLE001
        job.phase = JobPhase.error; job.error = str(exc)[:300]
        await log("error", "error", job.error); await update(job)


async def _continue_from_schema_discovery(job: JobState, knowledge, primary: ServiceDescriptor, update, log) -> None:
    job.phase = JobPhase.schema_discovery; await update(job)
    schema = await schema_discovery.run(knowledge, primary, job.request.exercise_ids, log)
    job.schema_ = schema; job.percent = 55; await update(job)

    # Exhaustive discovery: probe every action the bridge advertises that
    # schema_discovery doesn't already recognize by name, keep only what
    # comes back as real data. Runs before persisting/pausing so anything
    # found is included in the manager's module review, not bolted on after.
    await auto_discovery.run(schema, primary, job.request.exercise_ids, log)
    job.schema_ = schema; await update(job)

    await put_knowledge(knowledge)  # persist learned services/ids

    if schema.modules:
        job.phase = JobPhase.review_services
        job.available_modules = list(schema.modules)
        job.percent = 60
        await log("schema_discovery", "info",
                  f"Found {len(schema.modules)} real module(s): {', '.join(schema.modules)}. "
                  "Review and confirm which to include.")
        await update(job)
        return  # paused — resumed via resume_with_services()

    await _continue_from_planning(job, knowledge, primary, schema, update, log)


async def resume_with_services(job: JobState, selected_modules: list[str], update) -> None:
    """Resume a job paused at review_services, with the manager's chosen subset."""
    log = _mk_log(job, update)
    try:
        schema = job.schema_
        if schema is None:
            job.phase = JobPhase.error; job.error = "Cannot resume: no schema state on this job."
            await log("error", "error", job.error); await update(job); return

        # Never trust a client-supplied module name that wasn't actually
        # discovered — only ever narrow the REAL list, never extend it.
        valid = [m for m in selected_modules if m in job.available_modules]
        schema.modules = valid or job.available_modules
        await log("schema_discovery", "success",
                  f"Confirmed {len(schema.modules)} module(s): {', '.join(schema.modules)}")
        job.percent = 62
        await update(job)

        knowledge = job.knowledge
        primary = pick_primary(knowledge) if knowledge else None
        if not primary:
            job.phase = JobPhase.error; job.error = "Cannot resume: discovery state missing."
            await log("error", "error", job.error); await update(job); return

        await _continue_from_planning(job, knowledge, primary, schema, update, log)
    except Exception as exc:  # noqa: BLE001
        job.phase = JobPhase.error; job.error = str(exc)[:300]
        await log("error", "error", job.error); await update(job)


async def _continue_from_planning(job: JobState, knowledge, primary: ServiceDescriptor, schema: NormalizedSchema, update, log) -> None:
    req = job.request
    try:
        job.phase = JobPhase.dashboard_planning; await update(job)
        rows, filters, recs = await dashboard_planning.run(schema, log)
        job.percent = 68; await update(job)

        job.phase = JobPhase.dashboard_config; await update(job)
        cfg = await dashboard_config.run(knowledge, schema, primary, rows, filters, recs, log)
        cfg.connector_handle["base_url"] = primary.base_url
        job.dashboard = cfg; job.percent = 76; await update(job)

        job.phase = JobPhase.validation; await update(job)
        report = await validation.run(cfg, schema, primary, log)
        job.validation = report; job.percent = 84; await update(job)

        job.phase = JobPhase.preview; await update(job)
        pv = await preview.run(cfg, log)
        job.preview = pv; job.percent = 95; await update(job)

        if req.auto_publish and report.ok:
            job.phase = JobPhase.publish; await update(job)
            job.published = await publish.run(cfg, knowledge.domains, log)

        job.phase = JobPhase.done; job.percent = 100
        await log("done", "success", f"Dashboard generated for '{req.company}'. Review the preview and publish.")
        await update(job)
    except Exception as exc:  # noqa: BLE001
        job.phase = JobPhase.error; job.error = str(exc)[:300]
        await log("error", "error", job.error); await update(job)
