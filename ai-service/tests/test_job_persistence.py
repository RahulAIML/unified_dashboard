"""Regression tests for jobs.py's Postgres write-through + startup rehydration.

Found (ROADMAP B6): ai-service's builder state was in-memory only (_JOBS: dict) --
a process restart silently lost every in-flight AND completed job. A manager
mid-review_services, or a finished-but-not-yet-published dashboard, both just
vanished with no error anywhere.

These pin: every _update() call persists the job (write-through, not a
separate save step nobody remembers to call), a DB hiccup never breaks a
running job (persistence is a durability nice-to-have, not a correctness
requirement while the process is alive), and hydrate_from_db() reloads
everything back into _JOBS so get_job() works immediately after a restart.
"""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from app import jobs
from app.models import GenerateRequest, JobPhase, JobState


def _run(coro):
    return asyncio.run(coro)


def _job(job_id="job_1", phase=JobPhase.queued) -> JobState:
    return JobState(job_id=job_id, request=GenerateRequest(company="Besins"), phase=phase)


class _FakePool:
    def __init__(self):
        self.rows: dict[str, dict] = {}

    async def execute(self, sql, *params):
        job_id, phase, payload = params
        self.rows[job_id] = {"phase": phase, "payload": payload}

    async def fetch(self, sql):
        return [{"payload": r["payload"]} for r in self.rows.values()]


class UpdatePersistsToDbTests(unittest.TestCase):
    def setUp(self):
        jobs._JOBS.clear()

    def test_update_writes_through_to_the_db(self):
        pool = _FakePool()
        job = _job()
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            _run(jobs._update(job))
        self.assertIn("job_1", pool.rows)
        self.assertEqual(pool.rows["job_1"]["phase"], "queued")

    def test_update_still_updates_in_memory_when_no_db_configured(self):
        job = _job()
        with patch("app.db.get_pool", new=AsyncMock(return_value=None)):
            _run(jobs._update(job))
        self.assertIs(jobs.get_job("job_1"), job)

    def test_a_db_error_never_breaks_the_update(self):
        class ExplodingPool:
            async def execute(self, sql, *params):
                raise RuntimeError("connection reset")

        job = _job()
        with patch("app.db.get_pool", new=AsyncMock(return_value=ExplodingPool())):
            _run(jobs._update(job))  # must not raise
        self.assertIs(jobs.get_job("job_1"), job)

    def test_persisted_payload_round_trips_through_json(self):
        pool = _FakePool()
        job = _job(phase=JobPhase.review_services)
        job.available_modules = ["coach", "simulator"]
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            _run(jobs._update(job))
        restored = JobState.model_validate(json.loads(pool.rows["job_1"]["payload"]))
        self.assertEqual(restored.available_modules, ["coach", "simulator"])
        self.assertEqual(restored.phase, JobPhase.review_services)


class HydrateFromDbTests(unittest.TestCase):
    def setUp(self):
        jobs._JOBS.clear()

    def test_reloads_every_persisted_job_into_memory(self):
        pool = _FakePool()
        job = _job(job_id="job_after_restart")
        pool.rows["job_after_restart"] = {"phase": "queued", "payload": job.model_dump_json(by_alias=True)}

        self.assertIsNone(jobs.get_job("job_after_restart"))  # not in memory yet
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            _run(jobs.hydrate_from_db())

        self.assertIsNotNone(jobs.get_job("job_after_restart"))

    def test_a_malformed_row_does_not_block_the_others(self):
        pool = _FakePool()
        good = _job(job_id="good_job")
        pool.rows["bad_job"] = {"phase": "queued", "payload": "{not valid json"}
        pool.rows["good_job"] = {"phase": "queued", "payload": good.model_dump_json(by_alias=True)}

        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            _run(jobs.hydrate_from_db())

        self.assertIsNotNone(jobs.get_job("good_job"))

    def test_no_op_when_no_db_configured(self):
        with patch("app.db.get_pool", new=AsyncMock(return_value=None)):
            _run(jobs.hydrate_from_db())  # must not raise
        self.assertEqual(len(jobs._JOBS), 0)

    def test_submit_ids_works_on_a_job_only_present_after_hydration(self):
        # The real scenario this whole feature exists for: a manager was
        # mid-review on a job, the process restarted, and the resume call
        # must still find it -- not 409 as if the job never existed.
        pool = _FakePool()
        job = _job(job_id="paused_job", phase=JobPhase.needs_ids)
        pool.rows["paused_job"] = {"phase": "needs_ids", "payload": job.model_dump_json(by_alias=True)}

        async def scenario():
            await jobs.hydrate_from_db()
            with patch("app.jobs.resume_with_ids", new=AsyncMock()):
                return jobs.submit_ids("paused_job", [1, 2, 3])

        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            result = _run(scenario())

        self.assertIsNotNone(result)


if __name__ == "__main__":
    unittest.main()
