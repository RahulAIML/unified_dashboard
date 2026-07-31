"""Regression tests for:
  - agents/lms_discovery.py: LMS discovery runs independently of the primary
    connector and adds real DiscoveredMetric entries only when the school is
    actually reachable.
  - preview_fetch.py's fetch_widget dispatch: an lms-sourced widget must route
    by its OWN source_kind, not the dashboard's primary connector -- a
    pharma_kpi-primary dashboard (e.g. Apotex) can still carry LMS widgets,
    and routing by cfg.connector alone would incorrectly send them through
    _kpi() instead of _lms().
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import lms_discovery
from app.models import (
    CompanyKnowledge,
    DashboardConfig,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)
from app.preview_fetch import fetch_widget


def _run(coro):
    return asyncio.run(coro)


async def _noop_log(*_args):
    return None


class LmsDiscoveryTests(unittest.TestCase):
    def _knowledge(self) -> CompanyKnowledge:
        return CompanyKnowledge(company="Apotex", slug="apotex")

    def test_adds_no_metrics_when_lms_is_not_configured(self):
        schema = NormalizedSchema(company="Apotex", slug="apotex")
        with patch("app.lms.lms_probe", new=AsyncMock(return_value={"configured": False, "alive": False, "courses": 0, "note": "no creds"})):
            _run(lms_discovery.run(self._knowledge(), schema, _noop_log))
        self.assertEqual(schema.metrics, [])
        self.assertNotIn("lms", schema.modules)

    def test_adds_no_metrics_when_configured_but_unreachable(self):
        schema = NormalizedSchema(company="Apotex", slug="apotex")
        with patch("app.lms.lms_probe", new=AsyncMock(return_value={"configured": True, "alive": False, "courses": 0, "note": "401"})):
            _run(lms_discovery.run(self._knowledge(), schema, _noop_log))
        self.assertEqual(schema.metrics, [])

    def test_adds_real_lms_metrics_and_the_lms_module_when_alive(self):
        schema = NormalizedSchema(company="Apotex", slug="apotex")
        with patch("app.lms.lms_probe", new=AsyncMock(return_value={"configured": True, "alive": True, "courses": 15, "note": "OK"})):
            _run(lms_discovery.run(self._knowledge(), schema, _noop_log))
        keys = {m.key for m in schema.metrics}
        self.assertEqual(keys, {
            "lms_enrolled_users", "lms_completion_rate", "lms_avg_quiz_score",
            "lms_modules_completed", "lms_completion_trend", "lms_courses",
        })
        self.assertTrue(all(m.source_kind == ServiceKind.lms for m in schema.metrics))
        self.assertIn("lms", schema.modules)

    def test_lms_metrics_are_additive_to_an_existing_pharma_kpi_schema(self):
        # The core independence guarantee: LMS metrics coexist with the
        # primary connector's own metrics, never replacing them.
        schema = NormalizedSchema(
            company="Apotex", slug="apotex",
            metrics=[DiscoveredMetric(
                key="total_sessions", label="Total Sessions", type=MetricType.count,
                source_kind=ServiceKind.pharma_kpi, source_action="kpi.overview",
            )],
        )
        with patch("app.lms.lms_probe", new=AsyncMock(return_value={"configured": True, "alive": True, "courses": 15, "note": "OK"})):
            _run(lms_discovery.run(self._knowledge(), schema, _noop_log))
        keys = {m.key for m in schema.metrics}
        self.assertIn("total_sessions", keys)
        self.assertIn("lms_enrolled_users", keys)


class LmsPreviewDispatchTests(unittest.TestCase):
    def _widget(self, type_, metric_key=None) -> WidgetConfig:
        return WidgetConfig(id="w1", type=type_, title="t", metric_key=metric_key,
                            source_kind=ServiceKind.lms, source_action="lms.overview")

    def test_an_lms_widget_routes_correctly_on_a_pharma_kpi_primary_dashboard(self):
        # This is the key regression: cfg.connector is pharma_kpi (Apotex's
        # real primary), but the widget's OWN source_kind is lms -- it must
        # NOT be routed through _kpi().
        cfg = DashboardConfig(
            company="Apotex", slug="apotex", title="Apotex Analytics",
            connector=ServiceKind.pharma_kpi,
            connector_handle={"tenant": "apotex", "base_url": "https://bridge.test/apotex/bridge/"},
        )
        fake_lms_data = {
            "configured": True, "enrolledUsers": 29, "completionRate": 5.8,
            "avgQuizScore": None, "hasScoreData": False, "modulesCompleted": 12,
            "completionTrend": [], "courses": [],
        }
        with patch("app.lms.lms_dashboard", new=AsyncMock(return_value=fake_lms_data)):
            preview = _run(fetch_widget(cfg, self._widget(WidgetType.kpi_tile, "lms_enrolled_users")))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 29)

    def test_kpi_tile_reports_null_quiz_score_when_ungraded_not_zero(self):
        cfg = DashboardConfig(company="X", slug="x", title="X", connector=ServiceKind.rolplay_app_sql)
        fake_lms_data = {
            "configured": True, "enrolledUsers": 10, "completionRate": 20.0,
            "avgQuizScore": None, "hasScoreData": False, "modulesCompleted": 2,
            "completionTrend": [], "courses": [],
        }
        with patch("app.lms.lms_dashboard", new=AsyncMock(return_value=fake_lms_data)):
            preview = _run(fetch_widget(cfg, self._widget(WidgetType.kpi_tile, "lms_avg_quiz_score")))
        self.assertFalse(preview.ok)
        self.assertIsNone(preview.value)

    def test_line_chart_returns_the_completion_trend(self):
        cfg = DashboardConfig(company="X", slug="x", title="X", connector=ServiceKind.rolplay_app_sql)
        fake_lms_data = {
            "configured": True, "enrolledUsers": 10, "completionRate": 20.0,
            "avgQuizScore": None, "hasScoreData": False, "modulesCompleted": 2,
            "completionTrend": [{"date": "2026-07-10", "value": 3}], "courses": [],
        }
        with patch("app.lms.lms_dashboard", new=AsyncMock(return_value=fake_lms_data)):
            preview = _run(fetch_widget(cfg, self._widget(WidgetType.line_chart)))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.series, [{"date": "2026-07-10", "value": 3}])

    def test_table_returns_the_course_rows(self):
        cfg = DashboardConfig(company="X", slug="x", title="X", connector=ServiceKind.rolplay_app_sql)
        courses = [{"courseId": "c1", "name": "Course One", "enrolled": 29, "completed": 0, "inProgress": 0, "completionRate": 0.0, "avgScore": None}]
        fake_lms_data = {
            "configured": True, "enrolledUsers": 29, "completionRate": 0.0,
            "avgQuizScore": None, "hasScoreData": False, "modulesCompleted": 0,
            "completionTrend": [], "courses": courses,
        }
        with patch("app.lms.lms_dashboard", new=AsyncMock(return_value=fake_lms_data)):
            preview = _run(fetch_widget(cfg, self._widget(WidgetType.table)))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.rows, courses)

    def test_not_ok_when_lms_is_not_configured_for_this_tenant(self):
        cfg = DashboardConfig(company="X", slug="x", title="X", connector=ServiceKind.rolplay_app_sql)
        with patch("app.lms.lms_dashboard", new=AsyncMock(return_value={"configured": False})):
            preview = _run(fetch_widget(cfg, self._widget(WidgetType.kpi_tile, "lms_enrolled_users")))
        self.assertFalse(preview.ok)


if __name__ == "__main__":
    unittest.main()
