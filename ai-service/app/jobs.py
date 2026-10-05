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

from .models import GenerateRequest, JobLog, JobPhase, JobState
from .workflow import resume_with_ids, resume_with_services, run_generation

_JOBS: dict[str, JobState] = {}
_counter = 0

# Every individual network call in the pipeline already carries its own
# timeout (30s per rolplay_app_sql widget fetch, 45s per LLM call, etc.), so
# in the ordinary case the whole pipeline finishes in seconds. This is a
# WATCHDOG, not the expected runtime: a real live generation got stuck
# showing "Fetching live data..." at a fixed percent forever (confirmed live
# -- polling kept returning the exact same stale state, no error, no further
# log lines, indefinitely). Every individual bounded timeout should make that
# impossible, but "should" isn't a guarantee against the unbounded case (a
# hung DNS resolution, a stuck TCP connect that a lower-level timeout doesn't
# catch, event-loop starvation) -- and a job stuck mid-phase forever is
# invisible to _JOBS' only reader, get_job(), which has no way to tell "still
# genuinely running" apart from "silently wedged". This wraps the ENTIRE
# pipeline in a hard ceiling so get_job() is GUARANTEED to reach a terminal
# phase (done/error) within a bounded time no matter what hangs inside it,
# instead of potentially staying non-terminal forever.
_GENERATION_TIMEOUT_SECONDS = 240


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
    try:
        await asyncio.wait_for(run_generation(job, update), timeout=_GENERATION_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        # run_generation's own try/except (workflow.py) catches every
        # exception INSIDE the pipeline and always resolves to a terminal
        # phase -- but wait_for's TimeoutError is raised OUTSIDE that, once
        # the ceiling is hit, precisely because something in there never
        # returned at all. Mark the job terminal exactly the way that inner
        # handler does, so the one thing every caller of get_job() already
        # relies on (phase becomes done/error, never stays queued/running
        # forever) holds here too.
        stuck_in = job.phase.value
        job.phase = JobPhase.error
        job.error = (
            f"Generation timed out after {_GENERATION_TIMEOUT_SECONDS}s "
            f"(stuck in '{stuck_in}'). An upstream service may be slow "
            "or unresponsive -- try again."
        )
        job.logs.append(JobLog(phase=JobPhase.error, level="error", message=job.error))
        await update(job)


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
