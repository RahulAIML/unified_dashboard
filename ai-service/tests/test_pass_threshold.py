"""Task 7 -- configurable pass-rate threshold.

Different real customers pass at different bars (70/80/90), and some have
no score-based passing criteria at all (Sanfer certifies by completing
every assigned simulation, not by a score bar). This used to be a single
hardcoded PASS_THRESHOLD=70 global in preview_fetch.py -- every call site
now reads DashboardConfig.pass_threshold/has_no_passing_criteria instead,
configurable at build time (default 80) and editable after publish via
dashboard_versions.set_pass_threshold without a full regenerate.
"""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from app.models import DashboardConfig, ServiceKind, WidgetConfig, WidgetType
from app.preview_fetch import fetch_widget


def _run(coro):
    return asyncio.run(coro)


def _cfg(**overrides) -> DashboardConfig:
    return DashboardConfig(
        company="Siigo", slug="siigo", title="Siigo Analytics",
        connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 29},
        **overrides,
    )


def _pass_rate_tile() -> WidgetConfig:
    return WidgetConfig(id="tile_pass_rate", type=WidgetType.kpi_tile, title="Pass Rate",
                        metric_key="pass_rate", source_kind=ServiceKind.rolplay_app_sql,
                        source_action="r_user_session")


class PassThresholdWiringTests(unittest.TestCase):
    def test_the_configured_threshold_is_embedded_in_the_sql_not_a_hardcoded_70(self):
        captured_sql = {}

        async def fake_post_json(url, body, *args, **kwargs):
            captured_sql["sql"] = body.get("sql", "")
            return 200, {"data": [{"sessions": 10, "users": 5, "scored": 10, "avg_score": 80, "passed": 3}]}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_post_json)):
            preview = _run(fetch_widget(_cfg(pass_threshold=90), _pass_rate_tile()))

        self.assertIn(">=90", captured_sql["sql"].replace(" ", ""))
        self.assertNotIn(">=70", captured_sql["sql"].replace(" ", ""))
        self.assertEqual(preview.legend, "Passing threshold: 90 pts")

    def test_a_different_tenant_configured_at_70_embeds_70(self):
        captured_sql = {}

        async def fake_post_json(url, body, *args, **kwargs):
            captured_sql["sql"] = body.get("sql", "")
            return 200, {"data": [{"sessions": 10, "users": 5, "scored": 10, "avg_score": 60, "passed": 7}]}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_post_json)):
            preview = _run(fetch_widget(_cfg(pass_threshold=70), _pass_rate_tile()))

        self.assertIn(">=70", captured_sql["sql"].replace(" ", ""))
        self.assertEqual(preview.legend, "Passing threshold: 70 pts")

    def test_default_threshold_is_80_when_not_configured(self):
        captured_sql = {}

        async def fake_post_json(url, body, *args, **kwargs):
            captured_sql["sql"] = body.get("sql", "")
            return 200, {"data": [{"sessions": 10, "users": 5, "scored": 10, "avg_score": 80, "passed": 3}]}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_post_json)):
            _run(fetch_widget(_cfg(), _pass_rate_tile()))

        self.assertIn(">=80", captured_sql["sql"].replace(" ", ""))

    def test_no_passing_criteria_never_queries_and_never_fabricates_a_rate(self):
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=AssertionError("must not query"))):
            preview = _run(fetch_widget(_cfg(has_no_passing_criteria=True), _pass_rate_tile()))

        self.assertFalse(preview.ok)
        self.assertIsNone(preview.value)
        self.assertIsNone(preview.legend)
        self.assertIn("no score-based passing criteria", preview.error)

    def test_non_pass_rate_tile_is_unaffected_by_has_no_passing_criteria(self):
        async def fake_post_json(url, body, *args, **kwargs):
            return 200, {"data": [{"sessions": 42, "users": 5, "scored": 10, "avg_score": 80, "passed": 3}]}

        tile = WidgetConfig(id="tile_total_sessions", type=WidgetType.kpi_tile, title="Total Sessions",
                            metric_key="total_sessions", source_kind=ServiceKind.rolplay_app_sql,
                            source_action="r_user_session")
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_post_json)):
            preview = _run(fetch_widget(_cfg(has_no_passing_criteria=True), tile))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 42)


class _FakePool:
    def __init__(self, config: DashboardConfig):
        self.stored = config.model_dump_json()

    async def fetchrow(self, sql, *params):
        if "SELECT config FROM dashboard_metadata" in sql:
            return {"config": self.stored}
        return None

    async def execute(self, sql, *params):
        if "UPDATE dashboard_metadata SET config" in sql:
            _slug, new_config = params
            self.stored = new_config


class SetPassThresholdTests(unittest.TestCase):
    def _cfg(self):
        return DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics",
            connector=ServiceKind.rolplay_app_sql, pass_threshold=80,
        )

    def test_updates_the_threshold_without_touching_pages_or_version(self):
        from app import dashboard_versions
        cfg = self._cfg()
        pool = _FakePool(cfg)
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_pass_threshold("siigo", 70, False))

        self.assertIsNotNone(result)
        self.assertEqual(result.pass_threshold, 70)
        self.assertFalse(result.has_no_passing_criteria)
        self.assertEqual(result.version, cfg.version)  # no version bump -- not a layout change
        self.assertEqual(result.pages, cfg.pages)

    def test_sets_no_passing_criteria(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_pass_threshold("siigo", 80, True))
        self.assertTrue(result.has_no_passing_criteria)

    def test_persists_across_a_second_read(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            _run(dashboard_versions.set_pass_threshold("siigo", 90, False))
            reloaded = DashboardConfig.model_validate(json.loads(pool.stored))
        self.assertEqual(reloaded.pass_threshold, 90)

    def test_returns_none_for_an_unknown_slug(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        pool.fetchrow = AsyncMock(return_value=None)
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_pass_threshold("does-not-exist", 70, False))
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
