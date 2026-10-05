"""Post-launch layout freeze (ticket: layout must not change automatically
once delivered to a client). publish.py must refuse to overwrite an
already-published slug's config/version unless the caller explicitly opts
in via force=True -- protecting against a manager accidentally re-running
generate+publish for a company that's already live.
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
        self.version_rows: list[tuple[str, int]] = []

    async def fetchrow(self, sql, *params):
        if "SELECT published FROM dashboard_metadata" in sql:
            if self.metadata_version == 0:
                return None  # never published yet
            return {"published": self.published}
        if "INSERT INTO dashboard_metadata" in sql:
            _slug, _company, _config, version = params
            self.metadata_version += 1
            self.published = True
            return {"version": self.metadata_version}
        return None

    async def execute(self, sql, *params):
        if "INSERT INTO dashboard_versions" in sql:
            slug, version, _config = params
            self.version_rows.append((slug, version))


class PublishLayoutFreezeTests(unittest.TestCase):
    def _cfg(self, slug="salinas"):
        return DashboardConfig(company="Salinas", slug=slug, title="Salinas Analytics",
                               connector=ServiceKind.rolplay_app_sql, version=1)

    def test_first_publish_of_a_slug_always_succeeds(self):
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            ok = _run(publish.run(self._cfg(), [], _noop_log))
        self.assertTrue(ok)
        self.assertEqual(pool.version_rows, [("salinas", 1)])

    def test_republishing_an_already_live_slug_without_force_is_blocked(self):
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            _run(publish.run(self._cfg(), [], _noop_log))  # first publish -- goes live
            ok = _run(publish.run(self._cfg(), [], _noop_log))  # accidental re-run

        self.assertFalse(ok)
        # No new version was written -- the live layout is untouched.
        self.assertEqual(pool.version_rows, [("salinas", 1)])

    def test_force_republish_true_overrides_the_freeze(self):
        pool = _FakePool()
        with patch("app.agents.publish.get_pool", return_value=pool):
            _run(publish.run(self._cfg(), [], _noop_log))
            ok = _run(publish.run(self._cfg(), [], _noop_log, force=True))

        self.assertTrue(ok)
        self.assertEqual(pool.version_rows, [("salinas", 1), ("salinas", 2)])

    def test_a_never_published_slug_is_not_blocked_by_a_stale_published_false_row(self):
        # A row can exist (e.g. from an earlier failed attempt) with
        # published=FALSE -- that must never count as "already live".
        pool = _FakePool(published=False)
        pool.metadata_version = 1  # simulate an existing-but-unpublished row
        with patch("app.agents.publish.get_pool", return_value=pool):
            ok = _run(publish.run(self._cfg(), [], _noop_log))
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
