"""In-process async job manager for long-running generation jobs.

_JOBS (in-memory) stays the source of truth WHILE the process is running —
every existing read (get_job/submit_ids/submit_services/latest_for_slug)
is unchanged, sync, and just as fast as before. On top of that, every
update now also write-through persists to Postgres (job_state table, same
shared auth DB every other ai-service table already uses), and
hydrate_from_db() — called once at FastAPI startup — reloads everything
back into _JOBS before the app serves its first request.

This is what closes ROADMAP's B6: before this, a process restart silently
lost every in-flight and completed job (a manager mid-review_services, or
a finished-but-not-yet-published dashboard, both just vanished). With no
AUTH_DATABASE_URL configured, get_pool() returns None and this degrades
to exactly the old in-memory-only behaviour -- never a hard dependency.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone

from .models import GenerateRequest, JobPhase, JobState
from .workflow import resume_with_ids, resume_with_services, run_generation

_JOBS: dict[str, JobState] = {}
_counter = 0


async def _persist(job: JobState) -> None:
    from .db import get_pool

    pool = await get_pool()
    if not pool:
        return
    try:
        await pool.execute(
            """INSERT INTO job_state (job_id, phase, payload, updated_at)
                 VALUES ($1,$2,$3::jsonb,NOW())
               ON CONFLICT (job_id) DO UPDATE SET
                 phase=EXCLUDED.phase, payload=EXCLUDED.payload, updated_at=NOW()""",
            job.job_id, job.phase.value, job.model_dump_json(by_alias=True),
        )
    except Exception:
        # Persistence is a durability nice-to-have, not a correctness
        # requirement while the process is alive -- _JOBS already has the
        # authoritative state. Never let a DB hiccup break a running job.
        pass


async def hydrate_from_db() -> None:
    """Reload every job from job_state into _JOBS. Called once at startup
    (see main.py) so a restart doesn't leave get_job() returning None for
    a job a manager was actively reviewing moments before."""
    from .db import get_pool

    pool = await get_pool()
    if not pool:
        return
    try:
        rows = await pool.fetch("SELECT payload FROM job_state")
    except Exception:
        return
    for row in rows:
        try:
            job = JobState.model_validate(json.loads(row["payload"]))
        except Exception:
            continue  # one malformed row must never block every other job
        _JOBS[job.job_id] = job


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
    await _persist(job)


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
