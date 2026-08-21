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
    insights,
    lms_discovery,
    planner,
    preview,
    publish,
    schema_discovery,
    service_discovery,
    validation,
)
from .agents.service_discovery import pick_primary, pick_secondary
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
        # req.domains: the manager-typed login domain(s), if supplied. Without
        # this, company_discovery falls back to guess_domains(company, slug)
        # -- a naive "{slug}.com" guess that's often wrong (e.g. 'sanfer.com'
        # when reps are really on 'sanfer.com.mx') and silently breaks client
        # logins. graph.py's alternate (unused) pipeline already threaded
        # this through; this is the one the API actually calls.
        knowledge = await company_discovery.run(req.company, req.exercise_ids, log, req.domains)
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

    # Independent of the primary connector -- a tenant's LearnWorlds school
    # (if any) is discovered regardless of whether the primary is pharma_kpi/
    # rolplay_app_sql/coach_app_sql. See lms_discovery.py's docstring.
    await lms_discovery.run(knowledge, schema, log)
    job.schema_ = schema; await update(job)

    # A second alive-with-data connector (see pick_secondary's docstring —
    # found live: Besins had 17 real coach_app_sql sessions that pick_primary
    # correctly didn't choose as primary, but which were then silently
    # dropped entirely). Additive only: never pauses the pipeline, never
    # blocks on missing IDs -- a secondary that needs IDs we don't have is
    # skipped rather than making the whole dashboard wait on it.
    secondary = pick_secondary(knowledge, primary)
    if secondary and not (secondary.kind in _NEEDS_IDS and not knowledge.exercise_ids):
        secondary_schema = await schema_discovery.run(knowledge, secondary, job.request.exercise_ids, log)
        if secondary_schema.metrics:
            job.secondary_schema = secondary_schema
            await log("service_discovery", "success",
                      f"Also composing {secondary.kind.value} as its own page "
                      f"({len(secondary_schema.metrics)} real metric(s)) instead of dropping it.")
        await update(job)

    await put_knowledge(knowledge)  # persist learned services/ids

    if schema.modules and primary.kind != ServiceKind.rolplay_app_sql:
        job.phase = JobPhase.review_services
        job.available_modules = list(schema.modules)
        job.percent = 60
        await log("schema_discovery", "info",
                  f"Found {len(schema.modules)} real module(s): {', '.join(schema.modules)}. "
                  "Review and confirm which to include.")
        await update(job)
        return  # paused — resumed via resume_with_services()

    if schema.modules and primary.kind == ServiceKind.rolplay_app_sql:
        # rolplay_app_sql clients must generate with zero manager intervention
        # (every client, fully automatic) — auto-confirm all discovered
        # modules rather than pausing. A manager can still narrow the set
        # after the fact via PUT/republish; other connectors keep the
        # review_services pause unchanged.
        await log("schema_discovery", "success",
                  f"Auto-confirmed {len(schema.modules)} module(s): {', '.join(schema.modules)}")

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
        required_services = frozenset(job.request.services)
        job.phase = JobPhase.dashboard_planning; await update(job)
        pages, filters, recs = await dashboard_planning.run(
            schema, log, secondary_schema=job.secondary_schema, required_services=required_services,
        )
        job.percent = 68; await update(job)

        job.phase = JobPhase.dashboard_config; await update(job)
        # Re-resolve the secondary service DESCRIPTOR (not just its schema,
        # already persisted on job.secondary_schema) so dashboard_config can
        # merge its connector handle (e.g. coach_app_sql's customer_id) in
        # alongside the primary's -- cheap and deterministic, no re-probing.
        secondary = pick_secondary(knowledge, primary) if job.secondary_schema else None
        cfg = await dashboard_config.run(knowledge, schema, primary, pages, filters, recs, log,
                                         secondary=secondary, required_services=required_services)
        cfg.connector_handle["base_url"] = primary.base_url
        cfg.confidential = req.confidential
        cfg.pass_threshold = req.pass_threshold
        cfg.has_no_passing_criteria = req.has_no_passing_criteria
        job.dashboard = cfg; job.percent = 76; await update(job)

        job.phase = JobPhase.validation; await update(job)
        report = await validation.run(cfg, schema, primary, log, secondary_schema=job.secondary_schema)
        job.validation = report; job.percent = 84; await update(job)

        job.phase = JobPhase.preview; await update(job)
        pv = await preview.run(cfg, log)
        job.preview = pv; job.percent = 95; await update(job)

        # AI Insights: must run AFTER preview — it reasons over the ACTUAL
        # fetched values, never the schema alone. rolplay_app_sql only for
        # now; a no-op (empty list) for every other connector, unchanged.
        cfg.insights = await insights.run(cfg, pv, log)
        job.dashboard = cfg; await update(job)

        if req.auto_publish and report.ok:
            job.phase = JobPhase.publish; await update(job)
            job.published = await publish.run(cfg, knowledge.domains, log, force=req.force_republish)

        job.phase = JobPhase.done; job.percent = 100
        await log("done", "success", f"Dashboard generated for '{req.company}'. Review the preview and publish.")
        await update(job)
    except Exception as exc:  # noqa: BLE001
        job.phase = JobPhase.error; job.error = str(exc)[:300]
        await log("error", "error", job.error); await update(job)
