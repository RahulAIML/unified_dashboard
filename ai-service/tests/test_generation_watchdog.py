"""Regression: a real live generation got stuck at "Fetching live data..."
forever -- 0%, no further log lines, no error, polling returned the exact
same stale state indefinitely. Every individual network call in the
pipeline already carries its own bounded timeout (30s per rolplay_app_sql
widget fetch, 45s per LLM call), so this should be impossible in the
ordinary case -- but a job stuck mid-phase forever is invisible to
get_job()'s only reader, since _run() previously just awaited
run_generation() with no outer ceiling at all.

These pin jobs.py's _run(): no matter what hangs inside run_generation
(even something that never raises, just never returns), the job is
GUARANTEED to reach a terminal phase (done/error) within
_GENERATION_TIMEOUT_SECONDS, so get_job() can never be stuck reporting a
non-terminal phase forever.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app import jobs
from app.models import GenerateRequest, JobPhase, JobState


def _run(coro):
    return asyncio.run(coro)


def _job(job_id="job_1", phase=JobPhase.preview) -> JobState:
    return JobState(job_id=job_id, request=GenerateRequest(company="Chinoin"), phase=phase)


class GenerationWatchdogTests(unittest.TestCase):
    def setUp(self):
        jobs._JOBS.clear()

    def test_a_pipeline_that_never_returns_still_resolves_to_a_terminal_error_phase(self):
        job = _job(phase=JobPhase.preview)

        async def hangs_forever(_job, _update):
            await asyncio.Event().wait()  # never set -- simulates a genuine hang

        updated: list[JobState] = []

        async def update(j: JobState) -> None:
            updated.append(j)

        with patch("app.jobs.run_generation", new=hangs_forever), \
             patch("app.jobs._GENERATION_TIMEOUT_SECONDS", 0.05):
            _run(jobs._run(job, update))

        self.assertEqual(job.phase, JobPhase.error)
        self.assertIsNotNone(job.error)
        self.assertIn("timed out", job.error)
        # The message names the phase it was actually stuck in (preview),
        # not "error" -- the phase this handler itself just set.
        self.assertIn("preview", job.error)
        self.assertTrue(updated, "update() must be called so _JOBS/persistence reflect the terminal state")
        self.assertTrue(any(log.level == "error" for log in job.logs))

    def test_a_normal_fast_pipeline_is_unaffected(self):
        job = _job()

        async def finishes_immediately(j: JobState, update) -> None:
            j.phase = JobPhase.done
            j.percent = 100
            await update(j)

        updated: list[JobState] = []

        async def update(j: JobState) -> None:
            updated.append(j)

        with patch("app.jobs.run_generation", new=finishes_immediately), \
             patch("app.jobs._GENERATION_TIMEOUT_SECONDS", 240):
            _run(jobs._run(job, update))

        self.assertEqual(job.phase, JobPhase.done)
        self.assertIsNone(job.error)

    def test_an_exception_inside_the_pipeline_is_unaffected_by_the_watchdog(self):
        # run_generation's OWN try/except (workflow.py) already turns a raised
        # exception into phase=error -- the watchdog must not interfere with
        # or double-handle that path.
        job = _job()

        async def raises(j: JobState, update) -> None:
            j.phase = JobPhase.error
            j.error = "No live data service found for 'Chinoin'."
            await update(j)
            raise RuntimeError("should already be handled before this point in the real pipeline")

        updated: list[JobState] = []

        async def update(j: JobState) -> None:
            updated.append(j)

        with patch("app.jobs.run_generation", new=raises), \
             patch("app.jobs._GENERATION_TIMEOUT_SECONDS", 240):
            with self.assertRaises(RuntimeError):
                _run(jobs._run(job, update))

        # The job's own state (set before the raise) is untouched by the
        # watchdog -- _run only intervenes on TimeoutError, never re-wraps or
        # swallows a different exception.
        self.assertEqual(job.error, "No live data service found for 'Chinoin'.")


if __name__ == "__main__":
    unittest.main()
