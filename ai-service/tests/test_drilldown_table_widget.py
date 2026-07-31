"""Regression/coverage tests for the "Recent Sessions" drilldown table.

No AI-generated widget ever had a click-through anywhere — every table was
an aggregated breakdown (by usecase/simulator/category), never a listing of
individual sessions with a real id. The hand-built /drilldown/[id] page
already exists and resolves an id server-side, scoped to the viewer's own
tenant (lib/data-provider.ts's getDrilldown -> lib/bridge-client.ts's
bridgeDrilldown), for exactly the same report_field_current/saved_reports
tables preview_fetch.py's _coach_app already queries.

Scoped to coach_app_sql ONLY, on purpose: that's the one connector kind with
a VERIFIED matching drilldown backend. pharma_kpi/sale_exercises/exceltis_rest
resolve through a different path (pharmaDashboardDrilldown) this pipeline has
no verified handle-mapping for, and rolplay_app_sql has no working drilldown
path documented anywhere -- both correctly get no drilldown table rather
than a guessed, possibly-wrong one.
"""
import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import dashboard_planning
from app.agents.dashboard_planning import _auto_drilldown_table
from app.config import get_settings
from app.preview_fetch import DRILLDOWN_TABLE_ID, fetch_widget
from app.models import (
    DashboardConfig,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)


def _run(coro):
    return asyncio.run(coro)


async def _noop_log(*_args):
    return None


def _coach_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Besins", slug="besins", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.coach_app_sql, source_action="report_field_current"),
    ])


def _rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Siigo", slug="siigo", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
    ])


class AutoDrilldownTableTests(unittest.TestCase):
    def test_builds_a_widget_with_id_field_for_coach_app_sql(self):
        widgets = _auto_drilldown_table(_coach_schema(), set())
        self.assertEqual(len(widgets), 1)
        self.assertEqual(widgets[0].id, "table_recent_sessions")
        self.assertEqual(widgets[0].id_field, "saved_report_id")
        self.assertEqual(widgets[0].source_kind, ServiceKind.coach_app_sql)

    def test_none_for_rolplay_app_sql_no_verified_backend(self):
        self.assertEqual(_auto_drilldown_table(_rolplay_schema(), set()), [])

    def test_none_for_pharma_kpi_no_verified_backend(self):
        schema = NormalizedSchema(company="Apotex", slug="apotex", metrics=[
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=ServiceKind.pharma_kpi, source_action="kpi.overview"),
        ])
        self.assertEqual(_auto_drilldown_table(schema, set()), [])

    def test_not_added_twice(self):
        widgets = _auto_drilldown_table(_coach_schema(), {"table_recent_sessions"})
        self.assertEqual(widgets, [])

    def test_none_with_no_metrics(self):
        self.assertEqual(_auto_drilldown_table(NormalizedSchema(company="X", slug="x"), set()), [])


class DrilldownTableInFullPlanTests(unittest.TestCase):
    def test_coach_app_sql_dashboard_gets_a_drilldown_table(self):
        pages = _run(dashboard_planning.run(_coach_schema(), _noop_log))[0]
        overview = next(p for p in pages if p.id == "overview")
        widget_ids = {w.id for r in overview.rows for w in r.widgets}
        self.assertIn("table_recent_sessions", widget_ids)

    def test_rolplay_app_sql_dashboard_gets_no_drilldown_table(self):
        pages = _run(dashboard_planning.run(_rolplay_schema(), _noop_log))[0]
        overview = next(p for p in pages if p.id == "overview")
        widget_ids = {w.id for r in overview.rows for w in r.widgets}
        self.assertNotIn("table_recent_sessions", widget_ids)


class DrilldownTableFetchTests(unittest.TestCase):
    """The widget id is routed by id (like the approval donut), not
    metric_key -- these rows are real individual sessions, not a standalone
    discovered metric."""

    def setUp(self):
        os.environ["BRIDGE_URL"] = "https://bridge.test/exec"
        os.environ["BRIDGE_SECRET"] = "test-secret"
        get_settings.cache_clear()

    def tearDown(self):
        os.environ.pop("BRIDGE_URL", None)
        os.environ.pop("BRIDGE_SECRET", None)
        get_settings.cache_clear()

    def _cfg(self):
        return DashboardConfig(
            company="Besins", slug="besins", title="Besins Analytics",
            connector=ServiceKind.coach_app_sql, connector_handle={"customer_id": 16},
        )

    def _widget(self, widget_id=DRILLDOWN_TABLE_ID):
        return WidgetConfig(id=widget_id, type=WidgetType.table, title="Recent Sessions",
                            id_field="saved_report_id", source_kind=ServiceKind.coach_app_sql,
                            source_action="report_field_current")

    def test_returns_rows_with_saved_report_id(self):
        rows = [
            {"saved_report_id": 501, "date": "2026-07-01", "usecase_name": "Objection Handling",
             "score": 82.0, "passed_flag": 1},
            {"saved_report_id": 502, "date": "2026-07-02", "usecase_name": None,
             "score": 40.0, "passed_flag": 0},
        ]
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget()))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.rows[0]["saved_report_id"], 501)
        self.assertEqual(preview.rows[0]["result"], "Passed")
        self.assertEqual(preview.rows[1]["result"], "Failed")
        self.assertEqual(preview.rows[1]["usecase"], "—")

    def test_still_routes_correctly_when_the_id_is_prefixed_by_a_secondary_page(self):
        # dashboard_planning.py's _secondary_page prefixes every widget id
        # with "secondary_<kind>_" to avoid id collisions with the primary
        # page -- the fetch dispatch must still recognize it.
        prefixed = self._widget(widget_id=f"secondary_coach_app_sql_{DRILLDOWN_TABLE_ID}")
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": []}))):
            preview = _run(fetch_widget(self._cfg(), prefixed))
        self.assertFalse(preview.ok)  # no rows -- but NOT "no preview for ..."
        self.assertNotIn("no preview for", preview.error or "")

    def test_no_sessions_reports_empty_not_an_error(self):
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": []}))):
            preview = _run(fetch_widget(self._cfg(), self._widget()))
        self.assertFalse(preview.ok)
        self.assertEqual(preview.rows, [])


if __name__ == "__main__":
    unittest.main()
