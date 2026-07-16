"""In-process async job manager for long-running generation jobs."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from .models import GenerateRequest, JobPhase, JobState
from .workflow import resume_with_ids, resume_with_services, run_generation

_JOBS: dict[str, JobState] = {}
_counter = 0


async def _run(job: JobState, update) -> None:
    """Run the pipeline for a fresh job.

    NOTE: this intentionally calls the sequential pipeline (workflow.py)
    directly, NOT the LangGraph version (graph.py). The graph's conditional
    edges for the needs_ids/review_services pause points have an unresolved
    bug — the graph re-executes early nodes and hangs indefinitely rather than
    raising (so the old try/graph/except-fallback pattern never caught it,
    since there was no exception to catch). workflow.run_generation is the
    implementation that's actually been tested end-to-end (pause + resume,
    real data, no hang) — see the LangGraph formalization note in graph.py."""
    await run_generation(job, update)


def _next_id() -> str:
    global _counter
    _counter += 1
    ts = datetime.now(timezone.utc).strftime("%H%M%S")
    return f"job_{ts}_{_counter}"


async def _update(job: JobState) -> None:
    job.updated_at = datetime.now(timezone.utc)
    _JOBS[job.job_id] = job


def create_job(req: GenerateRequest) -> JobState:
    job = JobState(job_id=_next_id(), request=req)
    _JOBS[job.job_id] = job
    asyncio.create_task(_run(job, _update))
    return job


def get_job(job_id: str) -> JobState | None:
    return _JOBS.get(job_id)


def submit_ids(job_id: str, exercise_ids: list[int]) -> JobState | None:
    """Resume a job paused at needs_ids. Returns None if the job isn't in that state."""
    job = _JOBS.get(job_id)
    if not job or job.phase != JobPhase.needs_ids:
        return None
    asyncio.create_task(resume_with_ids(job, exercise_ids, _update))
    return job


def submit_services(job_id: str, selected_modules: list[str]) -> JobState | None:
    """Resume a job paused at review_services. Returns None if not in that state."""
    job = _JOBS.get(job_id)
    if not job or job.phase != JobPhase.review_services:
        return None
    asyncio.create_task(resume_with_services(job, selected_modules, _update))
    return job


def latest_for_slug(slug: str) -> JobState | None:
    matches = [j for j in _JOBS.values() if j.dashboard and j.dashboard.slug == slug]
    return max(matches, key=lambda j: j.updated_at) if matches else None
