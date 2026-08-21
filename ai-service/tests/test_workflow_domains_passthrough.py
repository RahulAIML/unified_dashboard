"""Regression: a manager-typed login domain must reach company_discovery, not
be silently replaced by a naive name-based guess.

Found live during the Dashboard Builder publish/access audit: GenerateRequest
.domains exists specifically so a manager's real domain (e.g.
"sanfer.com.mx") overrides guess_domains()'s often-wrong guess
("sanfer.com") -- see GenerateRequest.domains's own docstring in models.py.
But workflow.run_generation (the pipeline the API actually calls -- see
jobs.py's comment on why graph.py's LangGraph pipeline is NOT used) called
company_discovery.run(req.company, req.exercise_ids, log) with no 4th
argument, so it always fell back to the guess. graph.py's alternate,
unused pipeline already passed req.domains through correctly, which is
what exposed the gap in workflow.py.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app import workflow
from app.models import CompanyKnowledge, GenerateRequest, JobPhase, JobState


def _run(coro):
    return asyncio.run(coro)


async def _noop_update(_job):
    return None


class WorkflowDomainsPassthroughTests(unittest.TestCase):
    def test_manager_typed_domain_reaches_company_discovery(self):
        req = GenerateRequest(company="Sanfer", domains=["sanfer.com.mx"])
        job = JobState(job_id="j1", phase=JobPhase.queued, percent=0, request=req)

        fake_knowledge = CompanyKnowledge(company="Sanfer", slug="sanfer", domains=["sanfer.com.mx"], source="fresh")

        with patch("app.workflow.planner.run", new=AsyncMock(return_value=[])), \
             patch("app.workflow.company_discovery.run", new=AsyncMock(return_value=fake_knowledge)) as discover, \
             patch("app.workflow.service_discovery.run", new=AsyncMock(return_value=fake_knowledge)):
            # No alive services -> run_generation errors out right after
            # service_discovery, which is fine: the call we care about
            # (company_discovery.run) has already happened by then.
            _run(workflow.run_generation(job, _noop_update))

        # Assert on the actual call args directly (avoids over-specifying
        # positional vs keyword for the log callable, which is a closure).
        args = discover.call_args.args
        self.assertEqual(args[0], "Sanfer")
        self.assertEqual(args[1], req.exercise_ids)
        self.assertEqual(args[3], ["sanfer.com.mx"])

    def test_no_domain_supplied_still_calls_through_with_empty_list_not_omitted(self):
        req = GenerateRequest(company="NewCo")
        job = JobState(job_id="j2", phase=JobPhase.queued, percent=0, request=req)
        fake_knowledge = CompanyKnowledge(company="NewCo", slug="newco", domains=["newco.com"], source="fresh")

        with patch("app.workflow.planner.run", new=AsyncMock(return_value=[])), \
             patch("app.workflow.company_discovery.run", new=AsyncMock(return_value=fake_knowledge)) as discover, \
             patch("app.workflow.service_discovery.run", new=AsyncMock(return_value=fake_knowledge)):
            _run(workflow.run_generation(job, _noop_update))

        args = discover.call_args.args
        self.assertEqual(args[3], [])  # GenerateRequest.domains defaults to []


if __name__ == "__main__":
    unittest.main()
