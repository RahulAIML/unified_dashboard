"""Regression tests for the Reports page — part of reframing the builder
from "generates a dashboard" to "generates a complete analytics
application": Reports is a real, first-class artifact (paginated,
searchable, exportable), not an ad-hoc auto-discovered table.

Scoped to rolplay_app_sql only for this pass — the one connector with a
proven query shape for individual session rows. Every other connector's
_assemble_pages output is unaffected (see test_multi_page_dashboard.py's
existing pharma_kpi/LMS-only assertions, unchanged).
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.dashboard_planning import _assemble_pages, _reports_page
from app.models import (
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)
from app.preview_fetch import REPORTS_TABLE_ID, fetch_widget
from app.models import DashboardConfig


def _run(coro):
    return asyncio.run(coro)


def _rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Siigo", slug="siigo", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
    ])


def _non_rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Apotex", slug="apotex", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.pharma_kpi, source_action="kpi.overview"),
    ])


class ReportsPageTests(unittest.TestCase):
    def test_builds_a_reports_page_for_rolplay_app_sql(self):
        page = _reports_page(_rolplay_schema())
        self.assertEqual(page.id, "reports")
        self.assertEqual(page.title, "Reports")
        widget = page.rows[0].widgets[0]
        self.assertEqual(widget.id, "table_reports")
        self.assertTrue(widget.paginated)
        self.assertTrue(widget.searchable)
        self.assertTrue(widget.exportable)
        self.assertTrue(widget.business_question)

    def test_none_for_non_rolplay_app_sql_connectors(self):
        # Explicitly scoped -- pharma_kpi (and every other connector) gets
        # no Reports page from this pass; nothing else was touched.
        self.assertIsNone(_reports_page(_non_rolplay_schema()))

    def test_none_with_no_metrics_at_all(self):
        self.assertIsNone(_reports_page(NormalizedSchema(company="X", slug="x")))

    def test_assemble_pages_appends_reports_last(self):
        schema = _rolplay_schema()
        pages = _assemble_pages(schema, {}, [])
        self.assertEqual(pages[-1].id, "reports")

    def test_assemble_pages_has_no_reports_for_non_rolplay_schema(self):
        schema = _non_rolplay_schema()
        pages = _assemble_pages(schema, {}, [])
        self.assertNotIn("reports", [p.id for p in pages])


class ReportsWidgetFetchTests(unittest.TestCase):
    """Distinct query from the per-simulator breakdown (aggregated) and the
    drilldown table (capped at 50, no search) -- individual session rows,
    real rep identity, up to the Reports cap."""

    def _cfg(self):
        return DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics",
            connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 5},
        )

    def _widget(self):
        return WidgetConfig(id=REPORTS_TABLE_ID, type=WidgetType.table, title="Session Reports",
                            source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")

    def test_returns_individual_session_rows_not_aggregated(self):
        rows = [
            {"date": "2026-07-01", "rep": "a@siigo.com", "simulator": "Objection Handling", "score": 82.0, "result": "Passed"},
            {"date": "2026-07-02", "rep": "b@siigo.com", "simulator": "Objection Handling", "score": 40.0, "result": "Failed"},
        ]
        async def fake_post_json(url, body, headers=None):
            return 200, {"data": rows}
        with patch("app.preview_fetch.post_json", new=fake_post_json):
            preview = _run(fetch_widget(self._cfg(), self._widget()))
        self.assertTrue(preview.ok)
        self.assertEqual(len(preview.rows), 2)
        self.assertEqual(preview.rows[0]["rep"], "a@siigo.com")

    def test_empty_is_reported_not_an_error(self):
        async def fake_post_json(url, body, headers=None):
            return 200, {"data": []}
        with patch("app.preview_fetch.post_json", new=fake_post_json):
            preview = _run(fetch_widget(self._cfg(), self._widget()))
        self.assertFalse(preview.ok)
        self.assertEqual(preview.rows, [])

    def test_query_is_scoped_to_the_right_client_id(self):
        captured = {}
        async def fake_post_json(url, body, headers=None):
            captured["sql"] = body["sql"]
            return 200, {"data": []}
        with patch("app.preview_fetch.post_json", new=fake_post_json):
            _run(fetch_widget(self._cfg(), self._widget()))
        self.assertIn("u.client_id=5", captured["sql"])


if __name__ == "__main__":
    unittest.main()
