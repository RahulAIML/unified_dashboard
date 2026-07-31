"""Regression tests for dashboard_versions.py.

publish.py has always appended a snapshot row to dashboard_versions on every
publish, but until now nothing ever read it back -- a bad Gemini plan or a
wrong manual edit could only be fixed by regenerating and republishing from
scratch. These tests pin: listing versions, fetching one version's config,
and that rollback restores it as current WITHOUT losing history (rollback
itself becomes a new, still-restorable version).
"""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from app import dashboard_versions
from app.models import DashboardConfig, ServiceKind


def _run(coro):
    return asyncio.run(coro)


def _cfg(version=1, title="X Analytics") -> DashboardConfig:
    return DashboardConfig(
        company="X", slug="x", title=title, connector=ServiceKind.rolplay_app_sql, version=version,
    )


class _FakePool:
    def __init__(self):
        self.versions: dict[tuple[str, int], str] = {}
        self.metadata: dict[str, dict] = {}
        self.execute_calls: list[tuple[str, tuple]] = []

    async def fetch(self, sql, *params):
        slug = params[0]
        rows = [
            {"version": v, "created_at": _FakeTs()}
            for (s, v) in sorted(self.versions.keys(), key=lambda k: -k[1])
            if s == slug
        ]
        return rows

    async def fetchrow(self, sql, *params):
        if "dashboard_versions" in sql:
            slug, version = params
            cfg_json = self.versions.get((slug, version))
            return {"config": cfg_json} if cfg_json else None
        if "dashboard_metadata" in sql and sql.strip().startswith("INSERT"):
            slug, company, config, version = params
            existing = self.metadata.get(slug)
            new_version = (existing["version"] + 1) if existing else version
            self.metadata[slug] = {"company": company, "config": config, "version": new_version}
            return {"version": new_version}
        return None

    async def execute(self, sql, *params):
        self.execute_calls.append((sql, params))
        if "INSERT INTO dashboard_versions" in sql:
            slug, version, config = params
            self.versions[(slug, version)] = config


class _FakeTs:
    def isoformat(self):
        return "2026-07-31T00:00:00Z"


class DashboardVersionsTests(unittest.TestCase):
    def setUp(self):
        self.pool = _FakePool()

    def _seed(self, slug, version, cfg):
        self.pool.versions[(slug, version)] = cfg.model_dump_json()

    def test_returns_empty_list_when_no_pool(self):
        with patch("app.dashboard_versions.get_pool", new=AsyncMock(return_value=None)):
            self.assertEqual(_run(dashboard_versions.list_versions("x")), [])

    def test_lists_versions_newest_first(self):
        self._seed("x", 1, _cfg(1))
        self._seed("x", 2, _cfg(2))
        self._seed("x", 3, _cfg(3))
        with patch("app.dashboard_versions.get_pool", new=AsyncMock(return_value=self.pool)):
            versions = _run(dashboard_versions.list_versions("x"))
        self.assertEqual([v["version"] for v in versions], [3, 2, 1])

    def test_get_version_config_returns_none_for_missing_version(self):
        with patch("app.dashboard_versions.get_pool", new=AsyncMock(return_value=self.pool)):
            self.assertIsNone(_run(dashboard_versions.get_version_config("x", 99)))

    def test_get_version_config_returns_the_real_saved_config(self):
        self._seed("x", 2, _cfg(2, title="Version Two"))
        with patch("app.dashboard_versions.get_pool", new=AsyncMock(return_value=self.pool)):
            cfg = _run(dashboard_versions.get_version_config("x", 2))
        self.assertEqual(cfg.title, "Version Two")

    def test_rollback_returns_none_for_a_version_that_never_existed(self):
        with patch("app.dashboard_versions.get_pool", new=AsyncMock(return_value=self.pool)):
            self.assertIsNone(_run(dashboard_versions.rollback_to("x", 99)))

    def test_rollback_restores_the_old_content_as_current(self):
        self._seed("x", 1, _cfg(1, title="Original"))
        with patch("app.dashboard_versions.get_pool", new=AsyncMock(return_value=self.pool)):
            restored = _run(dashboard_versions.rollback_to("x", 1))
        self.assertEqual(restored.title, "Original")
        self.assertEqual(self.pool.metadata["x"]["company"], "X")

    def test_rollback_never_loses_history_it_appends_a_new_version(self):
        self._seed("x", 1, _cfg(1, title="Original"))
        self._seed("x", 2, _cfg(2, title="A bad edit"))
        # dashboard_metadata already has a row for "x" (version 2, from the
        # earlier bad publish) -- the realistic precondition for a rollback.
        # The INSERT...ON CONFLICT only increments on an actual conflict, so
        # without this the fake INSERT path wouldn't exercise it at all.
        self.pool.metadata["x"] = {"company": "X", "config": self.pool.versions[("x", 2)], "version": 2}
        with patch("app.dashboard_versions.get_pool", new=AsyncMock(return_value=self.pool)):
            restored = _run(dashboard_versions.rollback_to("x", 1))
            versions = _run(dashboard_versions.list_versions("x"))
        # The original bad-edit version (2) is still there...
        self.assertIn(2, [v["version"] for v in versions])
        # ...and the restore created a NEW version rather than overwriting it.
        self.assertGreater(restored.version, 2)
        self.assertIn(restored.version, [v["version"] for v in versions])


if __name__ == "__main__":
    unittest.main()
