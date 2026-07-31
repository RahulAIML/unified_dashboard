"""Regression tests for donut-chart / pass-fail-breakdown parity.

The real, hand-built Overview page every pharma-sim/rolplay-app client
actually sees pairs its bar/table breakdown with two donuts — a session-share
donut ("Use Case Distribution") and a Passed/Failed donut ("Approval vs.
Disapproval") — see components/DashboardContent.tsx's two DonutChart usages.
The AI Dashboard Builder never generated either: WidgetType.donut existed in
the model and the LLM's planning prompt could in principle propose one, but
nothing guaranteed it would for any given client, and the frontend had no
renderer for the type at all.

This pins the fix: a donut widget (session share) and, wherever a pass/fail
concept exists, a second donut (Passed vs Failed) are now added
deterministically for ANY connector with a real dimension breakdown — not
left to LLM chance — and the Passed/Failed donut reuses the SAME per-category
rows already fetched for the bar_chart/table, so it costs no extra query.

rolplay_app_sql (the rolplay.app/ajax/remote-access.php SQL endpoint) is
covered first since it's the primary, generalized data source; pharma_kpi and
coach_app_sql are covered too since the fix must hold for every connector,
not just one client.
"""
import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import validation
from app.agents.dashboard_planning import _auto_donut_widgets
from app.config import get_settings
from app.models import (
    DashboardConfig,
    DashboardRow,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceDescriptor,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)
from app.preview_fetch import _approval_donut, fetch_widget


def _run(coro):
    return asyncio.run(coro)


class ApprovalDonutHelperTests(unittest.TestCase):
    def test_sums_across_categories(self):
        preview = _approval_donut([100, 50, 3], [64, 30, 0], "w1")
        self.assertTrue(preview.ok)
        vals = {r["label"]: r["value"] for r in preview.rows}
        self.assertEqual(vals["Passed"], 94)
        self.assertEqual(vals["Failed"], 153 - 94)

    def test_reports_not_ok_when_no_sessions(self):
        preview = _approval_donut([], [], "w1")
        self.assertFalse(preview.ok)


class RolplayAppDonutPreviewTests(unittest.TestCase):
    """rolplay_app_sql: the primary data source (rolplay.app/ajax/remote-access.php)."""

    def _cfg(self) -> DashboardConfig:
        return DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics",
            connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 29},
        )

    def _widget(self, type_, id="w1") -> WidgetConfig:
        return WidgetConfig(id=id, type=type_, title="t",
                            source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")

    def test_donut_widget_returns_the_same_row_shape_as_bar_chart(self):
        rows = [{"simulator": "A", "total_sessions": 10, "avg_score": 80.0, "passed_sessions": 8, "pass_rate": 80.0}]
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget(WidgetType.donut)))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.rows[0]["simulator"], "A")

    def test_bar_chart_rows_now_carry_a_real_passed_sessions_count(self):
        rows = [{"simulator": "A", "total_sessions": 10, "avg_score": 80.0, "passed_sessions": 8, "pass_rate": 80.0}]
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget(WidgetType.bar_chart)))
        self.assertEqual(preview.rows[0]["passed_sessions"], 8)

    def test_approval_donut_sums_passed_sessions_across_simulators(self):
        rows = [
            {"simulator": "A", "total_sessions": 10, "passed_sessions": 8},
            {"simulator": "B", "total_sessions": 5, "passed_sessions": 1},
        ]
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget(WidgetType.donut, id="donut_approval")))
        self.assertTrue(preview.ok)
        vals = {r["label"]: r["value"] for r in preview.rows}
        self.assertEqual(vals["Passed"], 9)
        self.assertEqual(vals["Failed"], 6)

    def test_approval_donut_not_ok_with_zero_sessions(self):
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": []}))):
            preview = _run(fetch_widget(self._cfg(), self._widget(WidgetType.donut, id="donut_approval")))
        self.assertFalse(preview.ok)


class KpiApprovalBreakdownTests(unittest.TestCase):
    def _cfg(self) -> DashboardConfig:
        return DashboardConfig(
            company="Apotex", slug="apotex", title="Apotex Analytics",
            connector=ServiceKind.pharma_kpi,
            connector_handle={"tenant": "apotex", "base_url": "https://bridge.test/apotex/bridge/"},
        )

    def _widget(self, type_, id="w1") -> WidgetConfig:
        return WidgetConfig(id=id, type=type_, title="t",
                            source_kind=ServiceKind.pharma_kpi, source_action="kpi.activity_summary")

    def test_bar_rows_carry_passed_sessions(self):
        body = {"activities": [{"activity_name": "A", "sessions": 10, "sessions_pass": 7, "avg_score": 80, "pass_rate_pct": 70}]}
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, body))):
            preview = _run(fetch_widget(self._cfg(), self._widget(WidgetType.bar_chart)))
        self.assertEqual(preview.rows[0]["passed_sessions"], 7)

    def test_approval_donut_sums_sessions_pass(self):
        body = {"activities": [
            {"activity_name": "A", "sessions": 10, "sessions_pass": 7},
            {"activity_name": "B", "sessions": 4, "sessions_pass": 1},
        ]}
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, body))):
            preview = _run(fetch_widget(self._cfg(), self._widget(WidgetType.donut, id="donut_approval")))
        vals = {r["label"]: r["value"] for r in preview.rows}
        self.assertEqual(vals["Passed"], 8)
        self.assertEqual(vals["Failed"], 6)


class CoachAppApprovalBreakdownTests(unittest.TestCase):
    def setUp(self):
        # CoachAppConnector._sql short-circuits to None (never calling
        # post_json) when bridge_url/bridge_secret are unset — see
        # test_coach_app_preview.py, which this mirrors.
        os.environ["BRIDGE_URL"] = "https://bridge.test/exec"
        os.environ["BRIDGE_SECRET"] = "test-secret"
        get_settings.cache_clear()

    def tearDown(self):
        os.environ.pop("BRIDGE_URL", None)
        os.environ.pop("BRIDGE_SECRET", None)
        get_settings.cache_clear()

    def _cfg(self) -> DashboardConfig:
        return DashboardConfig(
            company="Takeda", slug="takeda", title="Takeda Analytics",
            connector=ServiceKind.coach_app_sql, connector_handle={"customer_id": 42},
        )

    def _widget(self, type_, id="w1") -> WidgetConfig:
        return WidgetConfig(id=id, type=type_, title="t",
                            source_kind=ServiceKind.coach_app_sql, source_action="report_field_current")

    def test_approval_donut_sums_passed_sessions(self):
        rows = [{"usecase_id": 1, "usecase_name": "Objection Handling",
                  "total_sessions": 3, "passed_sessions": 2, "avg_score": 70.0, "pass_rate": 66.7}]
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget(WidgetType.donut, id="donut_approval")))
        vals = {r["label"]: r["value"] for r in preview.rows}
        self.assertEqual(vals["Passed"], 2)
        self.assertEqual(vals["Failed"], 1)


class AutoDonutWidgetsTests(unittest.TestCase):
    def _schema(self, with_rate=True) -> NormalizedSchema:
        metrics = [
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        ]
        if with_rate:
            metrics.append(DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate,
                                            source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"))
        return NormalizedSchema(company="X", slug="x", metrics=metrics, dimensions=["activity"])

    def test_adds_both_donuts_when_dimension_and_rate_exist(self):
        widgets = _auto_donut_widgets(self._schema(), set())
        ids = {w.id for w in widgets}
        self.assertEqual(ids, {"donut_breakdown", "donut_approval"})
        approval = next(w for w in widgets if w.id == "donut_approval")
        self.assertEqual(approval.type, WidgetType.donut)
        # Regression: this donut used to set metric_key="approval_breakdown",
        # a string that is never a real schema_discovery-verified metric —
        # validation.py's missing_metric check (any widget whose metric_key
        # isn't in schema.metrics is an ERROR, by design: "never invent
        # metrics") correctly flagged every dashboard with this donut as
        # invalid. Confirmed live: Siigo's generated dashboard showed
        # "Validation failed - 1 error(s)" the first time this shipped. The
        # donut is routed by widget id in preview_fetch.py instead, so
        # metric_key must stay unset here.
        self.assertIsNone(approval.metric_key)

    def test_skips_approval_donut_without_a_rate_metric(self):
        widgets = _auto_donut_widgets(self._schema(with_rate=False), set())
        self.assertEqual({w.id for w in widgets}, {"donut_breakdown"})

    def test_adds_nothing_without_a_dimension_metric(self):
        schema = NormalizedSchema(company="X", slug="x", metrics=[
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        ])
        self.assertEqual(_auto_donut_widgets(schema, set()), [])

    def test_does_not_duplicate_already_present_widget_ids(self):
        widgets = _auto_donut_widgets(self._schema(), {"donut_breakdown", "donut_approval"})
        self.assertEqual(widgets, [])


class AutoDonutWidgetsPassValidationTests(unittest.TestCase):
    """End-to-end regression for the exact failure observed live: Siigo's
    generated dashboard showed "Validation failed - 1 error(s)" the first
    time this feature shipped, because the approval donut's metric_key wasn't
    a real schema_discovery metric. Runs the actual validation agent, not
    just an assertion on the widget's own field."""

    def test_auto_donut_widgets_never_trip_the_missing_metric_check(self):
        schema = NormalizedSchema(
            company="Siigo", slug="siigo",
            metrics=[
                DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                                 source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
                DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                                 source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
                DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate,
                                 source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            ],
            dimensions=["activity"],
        )
        donuts = _auto_donut_widgets(schema, set())
        cfg = DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics", connector=ServiceKind.rolplay_app_sql,
            rows=[DashboardRow(id="row_charts", title="Analytics", widgets=donuts)],
        )
        service = ServiceDescriptor(kind=ServiceKind.rolplay_app_sql, name="Siigo", base_url="x", has_data=True)

        async def _noop_log(*_args):
            return None

        report = _run(validation.run(cfg, schema, service, _noop_log))
        self.assertTrue(report.ok, f"expected 0 errors, got: {report.issues}")


if __name__ == "__main__":
    unittest.main()
