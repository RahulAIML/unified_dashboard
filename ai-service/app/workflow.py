"""Orchestration — runs the agent pipeline and streams progress into a JobState.

The agents are independent async functions (nodes); this module wires them in
order and manages phase/percent/logs. A LangGraph StateGraph view of the same
nodes lives in graph.py (formal graph); this pipeline is the runtime the API
uses so it works with or without langgraph installed.
"""
from __future__ import annotations

from .agents import (
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
from .models import JobPhase, JobState

# (phase, percent-on-completion)
_PHASES = [
    (JobPhase.planning, 8),
    (JobPhase.company_discovery, 18),
    (JobPhase.service_discovery, 38),
    (JobPhase.schema_discovery, 55),
    (JobPhase.dashboard_planning, 68),
    (JobPhase.dashboard_config, 76),
    (JobPhase.validation, 84),
    (JobPhase.preview, 95),
]


async def run_generation(job: JobState, update) -> None:
    """Run discovery→…→preview (and publish if auto). `update(job)` persists/broadcasts."""
    req = job.request

    async def log(phase: str, level: str, message: str) -> None:
        from .models import JobLog, JobPhase as JP
        job.logs.append(JobLog(phase=JP(phase), level=level, message=message))  # type: ignore[arg-type]
        await update(job)

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

        job.phase = JobPhase.schema_discovery; await update(job)
        schema = await schema_discovery.run(knowledge, primary, req.exercise_ids, log)
        job.schema_ = schema; job.percent = 55; await update(job)
        await put_knowledge(knowledge)  # persist learned services/ids

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
