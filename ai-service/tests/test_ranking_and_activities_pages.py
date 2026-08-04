"""Regression tests for the Ranking and Activities pages — added so the
AI-generated rolplay_app_sql dashboard matches the reference hand-built
per-tenant dashboards' page structure (docs/sanfer-dashboard-inventory.md:
"Clasificación"/"Actividades" nav items), which give the leaderboard and the
per-simulator breakdown their own first-class pages rather than burying them
inside Overview only.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.dashboard_planning import _activities_page, _assemble_pages, _ranking_page
from app.models import DashboardConfig, DiscoveredMetric, MetricType, NormalizedSchema, ServiceKind, WidgetConfig, WidgetType
from app.preview_fetch import BEST_PERFORMERS_ID, fetch_widget


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


class RankingPageTests(unittest.TestCase):
    def test_builds_a_ranking_page_for_rolplay_app_sql(self):
        page = _ranking_page(_rolplay_schema())
        self.assertEqual(page.id, "ranking")
        self.assertEqual(page.title, "Ranking")
        widget = page.rows[0].widgets[0]
        self.assertTrue(widget.id.endswith(BEST_PERFORMERS_ID))
        self.assertNotEqual(widget.id, BEST_PERFORMERS_ID, "must not collide with Overview's own leaderboard widget id")

    def test_none_for_non_rolplay_app_sql_connectors(self):
        self.assertIsNone(_ranking_page(_non_rolplay_schema()))

    def test_none_with_no_metrics_at_all(self):
        self.assertIsNone(_ranking_page(NormalizedSchema(company="X", slug="x")))


class ActivitiesPageTests(unittest.TestCase):
    def test_builds_an_activities_page_for_rolplay_app_sql(self):
        page = _activities_page(_rolplay_schema())
        self.assertEqual(page.id, "activities")
        self.assertEqual(page.title, "Activities")
        widget_types = {w.type for r in page.rows for w in r.widgets}
        self.assertEqual(widget_types, {WidgetType.bar_chart, WidgetType.donut, WidgetType.table})

    def test_none_for_non_rolplay_app_sql_connectors(self):
        self.assertIsNone(_activities_page(_non_rolplay_schema()))

    def test_widget_ids_dont_collide_with_overview_breakdown_widgets(self):
        page = _activities_page(_rolplay_schema())
        ids = {w.id for r in page.rows for w in r.widgets}
        self.assertTrue(all(i.startswith("activities_") for i in ids))


class RankingAndActivitiesInAssemblePagesTests(unittest.TestCase):
    def test_both_appended_before_reports_for_rolplay_app_sql(self):
        schema = _rolplay_schema()
        pages = _assemble_pages(schema, {}, [])
        ids = [p.id for p in pages]
        self.assertIn("ranking", ids)
        self.assertIn("activities", ids)
        self.assertLess(ids.index("ranking"), ids.index("reports"))
        self.assertLess(ids.index("activities"), ids.index("reports"))

    def test_absent_for_non_rolplay_app_sql_schema(self):
        pages = _assemble_pages(_non_rolplay_schema(), {}, [])
        ids = [p.id for p in pages]
        self.assertNotIn("ranking", ids)
        self.assertNotIn("activities", ids)


class RankingWidgetFetchTests(unittest.TestCase):
    """The prefixed ranking widget id must still route through the exact same
    real query as Overview's leaderboard widget -- proves the id-suffix
    routing (preview_fetch.py's .endswith(BEST_PERFORMERS_ID) check) actually
    works for the new prefixed id, not just the bare one."""

    def _cfg(self):
        return DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics",
            connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 29},
        )

    def test_fetches_real_leaderboard_data_for_the_prefixed_id(self):
        rows_in = [{"email": "a@x.com", "name": "Alice", "sessions": 10, "avg_score": 90.0, "passed": 9}]

        async def fake_sql(_url, _payload):
            return 200, {"data": rows_in}

        widget = WidgetConfig(id=f"ranking_{BEST_PERFORMERS_ID}", type=WidgetType.table, title="Best Performers",
                              source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(self._cfg(), widget))

        self.assertTrue(pv.ok)
        self.assertEqual(pv.rows[0]["user_email"], "a@x.com")


if __name__ == "__main__":
    unittest.main()
