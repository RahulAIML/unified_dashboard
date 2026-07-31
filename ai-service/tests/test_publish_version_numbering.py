"""Regression test for a real bug found live, 2026-07-31, while testing the
new rollback feature: publish.py's dashboard_versions INSERT always used
cfg.version, which dashboard_config.py hardcodes to 1 on every single
generation -- never incremented anywhere. dashboard_metadata's own version
DID increment correctly (SQL-side, via the ON CONFLICT clause), but that
real incremented value was never read back before the dashboard_versions
snapshot insert that follows it.

Confirmed live: GET /ai/dashboard-versions/apotex (Apotex, published 5
times over this project) returned 5 rows that ALL claimed to be "version 1",
indistinguishable except by timestamp -- making rollback-by-version
essentially meaningless. Fixed by RETURNING the real version from the
dashboard_metadata upsert and using THAT for the dashboard_versions snapshot.
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
    def __init__(self):
        self.metadata_version: dict[str, int] = {}
        self.version_rows: list[tuple[str, int]] = []

    async def fetchrow(self, sql, *params):
        if "INSERT INTO dashboard_metadata" in sql:
            slug, company, config, version = params
            if slug in self.metadata_version:
                self.metadata_version[slug] += 1
            else:
                self.metadata_version[slug] = version
            return {"version": self.metadata_version[slug]}
        return None

    async def execute(self, sql, *params):
        if "INSERT INTO dashboard_versions" in sql:
            slug, version, _config = params
            self.version_rows.append((slug, version))
        # pharma_tenants / domain inserts etc. -- irrelevant to this test,
        # no-op is fine since cfg.connector below isn't a pharma/rolplay-app
        # kind that would exercise those branches.


class PublishVersionNumberingTests(unittest.TestCase):
    def _cfg(self, slug="apotex"):
        return DashboardConfig(company="Apotex", slug=slug, title="Apotex Analytics",
                               connector=ServiceKind.second_brain, version=1)

    def test_first_publish_uses_the_metadata_row_version(self):
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            _run(publish.run(self._cfg(), [], _noop_log))
        self.assertEqual(pool.version_rows, [("apotex", 1)])

    def test_republishing_the_same_slug_gets_a_correctly_incrementing_version(self):
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            _run(publish.run(self._cfg(), [], _noop_log))
            _run(publish.run(self._cfg(), [], _noop_log))
            _run(publish.run(self._cfg(), [], _noop_log))

        # This is exactly the bug: before the fix, every entry here would be
        # ("apotex", 1) -- three publishes, one indistinguishable "version".
        self.assertEqual(pool.version_rows, [("apotex", 1), ("apotex", 2), ("apotex", 3)])

    def test_different_slugs_version_independently(self):
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            _run(publish.run(self._cfg(slug="apotex"), [], _noop_log))
            _run(publish.run(self._cfg(slug="siigo"), [], _noop_log))
            _run(publish.run(self._cfg(slug="apotex"), [], _noop_log))

        self.assertEqual(pool.version_rows, [("apotex", 1), ("siigo", 1), ("apotex", 2)])


if __name__ == "__main__":
    unittest.main()
