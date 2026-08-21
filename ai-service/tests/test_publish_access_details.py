"""publish.run's optional `details` out-param -- lets a caller (the /ai/publish
route) tell an admin WHERE a dashboard is reachable and WHO can log in, not
just whether the DB write "succeeded". Purely additive: callers that don't
pass `details` (all existing tests) are unaffected, and `run`'s bool return
value keeps its exact original meaning.
"""
import asyncio
import unittest
from unittest.mock import patch

from app.agents import publish
from app.models import DashboardConfig, ServiceKind


def _run(coro):
    return asyncio.run(coro)


async def _noop_log(*_args):
    return None


class _FakePool:
    def __init__(self, published: bool = False):
        self.published = published
        self.metadata_version = 0
        self.executed: list[tuple] = []

    async def fetchrow(self, sql, *params):
        if "SELECT published FROM dashboard_metadata" in sql:
            if self.metadata_version == 0:
                return None
            return {"published": self.published}
        if "INSERT INTO dashboard_metadata" in sql:
            self.metadata_version += 1
            self.published = True
            return {"version": self.metadata_version}
        return None

    async def execute(self, sql, *params):
        self.executed.append((sql, params))


class PublishAccessDetailsTests(unittest.TestCase):
    def _cfg(self, slug="siigo", connector=ServiceKind.rolplay_app_sql, connector_handle=None):
        return DashboardConfig(
            company="Siigo", slug=slug, title="Siigo Analytics",
            connector=connector, version=1, connector_handle=connector_handle or {},
        )

    def test_rolplay_app_sql_with_domain_reports_domain_routed(self):
        pool = _FakePool()
        details: dict = {}
        with patch("app.agents.publish.get_pool", return_value=pool):
            ok = _run(publish.run(self._cfg(connector_handle={"client_id": 24}), ["siigo.com"], _noop_log, details=details))
        self.assertTrue(ok)
        self.assertEqual(details["status"], "domain_routed")
        self.assertEqual(details["domain"], "siigo.com")
        self.assertEqual(details["client_id"], 24)

    def test_rolplay_app_sql_with_no_client_id_reports_no_client_id(self):
        pool = _FakePool()
        details: dict = {}
        with patch("app.agents.publish.get_pool", return_value=pool):
            ok = _run(publish.run(self._cfg(connector_handle={}), ["siigo.com"], _noop_log, details=details))
        self.assertTrue(ok)  # config still stored -- only routing is missing
        self.assertEqual(details["status"], "no_client_id")
        self.assertIsNone(details["domain"])

    def test_rolplay_app_sql_with_no_domain_and_no_derivable_domain_reports_no_domain(self):
        pool = _FakePool()
        details: dict = {}
        with patch("app.agents.publish.get_pool", return_value=pool), \
             patch("app.agents.publish._derive_domain", return_value=None):
            ok = _run(publish.run(self._cfg(connector_handle={"client_id": 24}), [], _noop_log, details=details))
        self.assertTrue(ok)
        self.assertEqual(details["status"], "no_domain")
        self.assertIsNone(details["domain"])
        self.assertEqual(details["client_id"], 24)

    def test_frozen_publish_reports_frozen_status_with_no_domain(self):
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            _run(publish.run(self._cfg(connector_handle={"client_id": 24}), ["siigo.com"], _noop_log))
            details: dict = {}
            ok = _run(publish.run(self._cfg(connector_handle={"client_id": 24}), ["siigo.com"], _noop_log, details=details))
        self.assertFalse(ok)
        self.assertEqual(details["status"], "frozen")
        self.assertIsNone(details["domain"])

    def test_details_defaults_to_a_fresh_dict_when_caller_omits_it(self):
        # Every existing call site (and every other test file) calls
        # publish.run without `details` -- must never raise.
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            ok = _run(publish.run(self._cfg(connector_handle={"client_id": 24}), ["siigo.com"], _noop_log))
        self.assertTrue(ok)

    def test_pharma_connector_with_domain_reports_domain_routed(self):
        pool = _FakePool()
        details: dict = {}
        cfg = self._cfg(connector=ServiceKind.pharma_sale_exercises, connector_handle={"exercise_ids": [1, 2]})
        with patch("app.agents.publish.get_pool", return_value=pool):
            ok = _run(publish.run(cfg, ["sanfer.com.mx"], _noop_log, details=details))
        self.assertTrue(ok)
        self.assertEqual(details["status"], "domain_routed")
        self.assertEqual(details["domain"], "sanfer.com.mx")


if __name__ == "__main__":
    unittest.main()
