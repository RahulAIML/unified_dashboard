"""In-process async job manager for long-running generation jobs."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from .models import GenerateRequest, JobState
from .workflow import run_generation

_JOBS: dict[str, JobState] = {}
_counter = 0


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
    asyncio.create_task(run_generation(job, _update))
    return job


def get_job(job_id: str) -> JobState | None:
    return _JOBS.get(job_id)


def latest_for_slug(slug: str) -> JobState | None:
    matches = [j for j in _JOBS.values() if j.dashboard and j.dashboard.slug == slug]
    return max(matches, key=lambda j: j.updated_at) if matches else None
