"""Regression tests for the Organization page: the full registered roster
(name/email/department/designation/joined date/last login/status), not just
the total_roster/"Registered Users" count tile.

Found live on Chinoin: 581 real r_user accounts, only 1 with any session --
the count tile alone told a manager THAT there's an adoption gap, but not
WHO the 580 unstarted people are. Same rolplay_app_sql-only scope as every
other auto-page (test_reports_page.py, test_rolplay_app_schema.py).
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.dashboard_planning import _assemble_pages, _organization_page
from app.models import (
    DashboardConfig,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)
from app.preview_fetch import REGISTERED_USERS_TABLE_ID, fetch_widget


def _run(coro):
    return asyncio.run(coro)


def _rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Chinoin", slug="chinoin", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        DiscoveredMetric(key="total_users", label="Active Users", type=MetricType.count,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user"),
        DiscoveredMetric(key="total_roster", label="Registered Users", type=MetricType.count,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user"),
    ])


def _non_rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Apotex", slug="apotex", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.pharma_kpi, source_action="kpi.overview"),
    ])


class OrganizationPageTests(unittest.TestCase):
    def test_builds_an_organization_page_when_total_roster_is_discovered(self):
        page = _organization_page(_rolplay_schema())
        self.assertEqual(page.id, "organization")
        self.assertEqual(page.title, "Organization")
        widget = page.rows[0].widgets[0]
        self.assertEqual(widget.id, f"organization_{REGISTERED_USERS_TABLE_ID}")
        self.assertTrue(widget.id.endswith(REGISTERED_USERS_TABLE_ID))
        self.assertEqual(widget.type, WidgetType.table)
        self.assertTrue(widget.business_question)

    def test_widget_is_paginated_searchable_and_exportable(self):
        # A full 581-row roster is unusable in MiniTable's unpaginated
        # 10-row/5-column preview -- must route to ReportsTable instead.
        widget = _organization_page(_rolplay_schema()).rows[0].widgets[0]
        self.assertTrue(widget.paginated)
        self.assertTrue(widget.searchable)
        self.assertTrue(widget.exportable)

    def test_none_without_the_total_roster_metric(self):
        # A schema with rolplay_app_sql metrics but no total_roster (e.g. a
        # client discovered before this fix shipped, or a future connector
        # that never adds it) must not get a half-built Organization page.
        schema = NormalizedSchema(company="X", slug="x", metrics=[
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        ])
        self.assertIsNone(_organization_page(schema))

    def test_none_for_non_rolplay_app_sql_connectors(self):
        self.assertIsNone(_organization_page(_non_rolplay_schema()))

    def test_none_with_no_metrics_at_all(self):
        self.assertIsNone(_organization_page(NormalizedSchema(company="X", slug="x")))

    def test_assemble_pages_includes_organization(self):
        schema = _rolplay_schema()
        pages = _assemble_pages(schema, {}, [])
        self.assertIn("organization", [p.id for p in pages])

    def test_assemble_pages_has_no_organization_for_non_rolplay_schema(self):
        schema = _non_rolplay_schema()
        pages = _assemble_pages(schema, {}, [])
        self.assertNotIn("organization", [p.id for p in pages])


class OrganizationWidgetFetchTests(unittest.TestCase):
    """The roster query itself: distinct from total_roster's plain
    COUNT(*) tile -- this returns the actual rows, never u.password, never
    joined to sessions or scoped by date range/category."""

    def _cfg(self):
        return DashboardConfig(
            company="Chinoin", slug="chinoin", title="Chinoin Analytics",
            connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 37},
        )

    def _widget(self):
        return WidgetConfig(id=f"organization_{REGISTERED_USERS_TABLE_ID}", type=WidgetType.table,
                            title="Registered Users", source_kind=ServiceKind.rolplay_app_sql,
                            source_action="r_user")

    def test_returns_full_roster_rows_with_expected_shape(self):
        rows = [
            {"name": " Claudia Salinas ", "email": "claudia@chinoin.com", "department": "Rinitis",
             "designation": "Gerente", "created_on": "2026-09-01 23:50:01", "last_loggedin": None, "disabled": 0},
            {"name": None, "email": "tester@chinoin.com", "department": "", "designation": "",
             "created_on": "2026-08-12 15:07:38", "last_loggedin": "2026-09-01 10:00:00", "disabled": 1},
        ]

        async def fake_sql(_url, _payload):
            return 200, {"data": rows}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(self._cfg(), self._widget()))

        self.assertTrue(pv.ok)
        self.assertEqual(pv.rows[0]["name"], "Claudia Salinas")
        self.assertEqual(pv.rows[0]["created_on"], "2026-09-01")
        self.assertIsNone(pv.rows[0]["last_loggedin"])
        self.assertEqual(pv.rows[0]["status"], "Active")
        self.assertIsNone(pv.rows[1]["name"])
        self.assertIsNone(pv.rows[1]["department"])
        self.assertEqual(pv.rows[1]["last_loggedin"], "2026-09-01")
        self.assertEqual(pv.rows[1]["status"], "Disabled")

    def test_empty_roster_is_reported_not_an_error(self):
        async def fake_sql(_url, _payload):
            return 200, {"data": []}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(self._cfg(), self._widget()))
        self.assertFalse(pv.ok)
        self.assertEqual(pv.rows, [])

    def test_query_is_scoped_to_the_right_client_and_never_selects_the_password(self):
        calls: list[str] = []

        async def fake_sql(_url, payload):
            calls.append(payload["sql"])
            return 200, {"data": []}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            _run(fetch_widget(self._cfg(), self._widget()))

        sql = calls[0]
        self.assertIn("client_id=37", sql)
        self.assertNotIn("password", sql.lower())
        self.assertNotIn("r_user_session", sql)
        self.assertNotIn("BETWEEN", sql)


if __name__ == "__main__":
    unittest.main()
