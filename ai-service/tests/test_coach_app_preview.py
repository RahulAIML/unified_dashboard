"""Regression test for the missing coach_app_sql preview handler.

Found live: every widget for a coach_app_sql-connected client (Takeda's
cached knowledge, at the time, incorrectly) rendered
"no preview for ServiceKind.coach_app_sql" -- fetch_widget had no case for
this connector at all, for any client, not just one.

_coach_app mirrors lib/bridge-client.ts's bridgeOverviewKpis /
bridgeUsecaseBreakdown EXACTLY (same tables, same SCORE_CASE normalisation,
same passed_flag join) so a generated dashboard shows the same numbers the
main Next.js app already shows this tenant, from the same schema.
"""
import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

from app.config import get_settings
from app.preview_fetch import fetch_widget
from app.models import DashboardConfig, ServiceKind, WidgetConfig, WidgetType


def _cfg(customer_id: int = 42) -> DashboardConfig:
    return DashboardConfig(
        company="Takeda", slug="takeda", title="Takeda Analytics",
        connector=ServiceKind.coach_app_sql,
        connector_handle={"customer_id": customer_id, "domain": "takeda.com"},
    )


def _widget(type_: WidgetType, metric_key: str | None = None, **extra) -> WidgetConfig:
    return WidgetConfig(
        id=f"w-{metric_key or type_.value}", type=type_, title="t",
        metric_key=metric_key, source_kind=ServiceKind.coach_app_sql,
        source_action="report_field_current", **extra,
    )


def _run(coro):
    return asyncio.run(coro)


class CoachAppPreviewTests(unittest.TestCase):
    def setUp(self):
        # CoachAppConnector._sql short-circuits to None (never calling
        # post_json at all) when bridge_url/bridge_secret are unset -- get_settings()
        # is @lru_cache'd, so the env vars must exist BEFORE the cache is
        # populated, and the cache must be cleared for this to take effect.
        os.environ["BRIDGE_URL"] = "https://bridge.test/exec"
        os.environ["BRIDGE_SECRET"] = "test-secret"
        get_settings.cache_clear()

    def tearDown(self):
        os.environ.pop("BRIDGE_URL", None)
        os.environ.pop("BRIDGE_SECRET", None)
        get_settings.cache_clear()

    def test_no_longer_falls_through_to_unsupported_connector(self):
        """The bug as observed: before this fix, fetch_widget's dispatch had no
        branch for coach_app_sql at all and returned the generic
        'no preview for {connector}' error for every widget."""
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": []}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "total_sessions")))

        self.assertNotIn("no preview for", preview.error or "")

    def test_kpi_tile_total_sessions(self):
        row = {"total_sessions": 5, "avg_score": "24.00", "passed": 1}
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": [row]}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "total_sessions")))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 5)

    def test_kpi_tile_avg_score(self):
        row = {"total_sessions": 5, "avg_score": "24.00", "passed": 1}
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": [row]}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "avg_score")))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 24.0)

    def test_kpi_tile_pass_rate_computed_from_passed_over_sessions(self):
        row = {"total_sessions": 5, "avg_score": "24.00", "passed": 1}
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": [row]}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "pass_rate")))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 20.0)  # 1/5 * 100

    def test_kpi_tile_zero_sessions_reports_null_not_zero(self):
        """No sessions must mean 'not measurable', not a fabricated 0% pass rate."""
        row = {"total_sessions": 0, "avg_score": None, "passed": 0}
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": [row]}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "pass_rate")))

        self.assertFalse(preview.ok)
        self.assertIsNone(preview.value)

    def test_unsupported_metric_key_is_reported_not_silently_dropped(self):
        row = {"total_sessions": 5, "avg_score": "24.00", "passed": 1}
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": [row]}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "made_up_metric")))

        self.assertFalse(preview.ok)
        self.assertIn("made_up_metric", preview.error or "")

    def test_bar_chart_usecase_breakdown(self):
        rows = [
            {"usecase_id": 1, "usecase_name": "Objection Handling", "total_sessions": 3, "avg_score": 70.0, "pass_rate": 66.7},
        ]
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": rows}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.bar_chart, dimension="usecase")))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.rows[0]["usecase"], "Objection Handling")

    def test_usecase_breakdown_falls_back_to_id_when_name_is_null(self):
        rows = [{"usecase_id": 9, "usecase_name": None, "total_sessions": 1, "avg_score": 50.0, "pass_rate": 0.0}]
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": rows}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.table, dimension="usecase")))

        self.assertEqual(preview.rows[0]["usecase"], "Usecase 9")

    def test_line_chart_trend(self):
        rows = [{"date": "2026-05-09", "avg_score": 24.0, "sessions": 2}]
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": rows}))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.line_chart)))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.series[0]["value"], 24.0)

    def test_no_customer_id_reports_a_specific_reason(self):
        cfg = _cfg(customer_id=0)
        preview = _run(fetch_widget(cfg, _widget(WidgetType.kpi_tile, "total_sessions")))

        self.assertFalse(preview.ok)
        self.assertIn("customer_id", preview.error or "")

    def test_query_is_scoped_to_the_right_customer_id(self):
        """The one thing that MUST be correct: never leak another tenant's rows."""
        captured = {}

        async def fake_post_json(url, body, headers=None):
            captured["sql"] = body["sql"]
            captured["params"] = body["params"]
            return 200, {"success": True, "data": [{"total_sessions": 1, "avg_score": 10, "passed": 0}]}

        with patch("app.connectors.coach_app.post_json", new=fake_post_json):
            _run(fetch_widget(_cfg(customer_id=777), _widget(WidgetType.kpi_tile, "total_sessions")))

        self.assertIn("customer_id = ?", captured["sql"])
        self.assertEqual(captured["params"][0], 777)


if __name__ == "__main__":
    unittest.main()
