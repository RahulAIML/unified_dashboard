"""Regression tests for the two remaining rolplay_app_sql parity gaps found
by the ERD/hand-built audit: the Best Performers leaderboard
(lib/bridge-rolplay-app.ts's rolplayAppBestPerformers, a prominent
Trophy-icon card on every hand-built Overview) and the daily pass/fail
volume (rolplayAppTrends' evalCountTrend/passFailTrend) — both previously
entirely absent from every AI-generated dashboard for this connector.
"""
import unittest

from app.agents.dashboard_planning import (
    _auto_best_performers_widget,
    _auto_daily_passfail_widget,
    _heuristic,
)
from app.models import DiscoveredMetric, MetricType, NormalizedSchema, ServiceKind
from app.preview_fetch import BEST_PERFORMERS_ID, DAILY_PASSFAIL_ID


def _rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Siigo", slug="siigo", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
    ])


def _non_rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Apotex", slug="apotex", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.pharma_kpi, source_action="kpi.overview"),
    ])


class BestPerformersWidgetTests(unittest.TestCase):
    def test_added_for_rolplay_app_sql(self):
        widgets = _auto_best_performers_widget(_rolplay_schema(), set())
        self.assertEqual(len(widgets), 1)
        self.assertEqual(widgets[0].id, BEST_PERFORMERS_ID)
        self.assertEqual(widgets[0].span, 4)
        self.assertTrue(widgets[0].business_question)

    def test_absent_for_other_connectors(self):
        self.assertEqual(_auto_best_performers_widget(_non_rolplay_schema(), set()), [])

    def test_not_duplicated_if_already_present(self):
        self.assertEqual(_auto_best_performers_widget(_rolplay_schema(), {BEST_PERFORMERS_ID}), [])

    def test_absent_with_no_metrics(self):
        self.assertEqual(_auto_best_performers_widget(NormalizedSchema(company="X", slug="x"), set()), [])

    def test_present_in_heuristic_overview_for_rolplay_app_sql(self):
        rows, _filters, _recs = _heuristic(_rolplay_schema(), {m.key: m for m in _rolplay_schema().metrics})
        widget_ids = {w.id for r in rows for w in r.widgets}
        self.assertIn(BEST_PERFORMERS_ID, widget_ids)


class DailyPassFailWidgetTests(unittest.TestCase):
    def test_added_for_rolplay_app_sql(self):
        widgets = _auto_daily_passfail_widget(_rolplay_schema(), set())
        self.assertEqual(len(widgets), 1)
        self.assertEqual(widgets[0].id, DAILY_PASSFAIL_ID)
        self.assertEqual(widgets[0].type.value, "bar_chart")

    def test_absent_for_other_connectors(self):
        self.assertEqual(_auto_daily_passfail_widget(_non_rolplay_schema(), set()), [])

    def test_not_duplicated_if_already_present(self):
        self.assertEqual(_auto_daily_passfail_widget(_rolplay_schema(), {DAILY_PASSFAIL_ID}), [])

    def test_present_in_heuristic_overview_for_rolplay_app_sql(self):
        rows, _filters, _recs = _heuristic(_rolplay_schema(), {m.key: m for m in _rolplay_schema().metrics})
        widget_ids = {w.id for r in rows for w in r.widgets}
        self.assertIn(DAILY_PASSFAIL_ID, widget_ids)


class NoDuplicateWidgetIdsTests(unittest.TestCase):
    """Both new widgets must never collide with any other widget id the
    heuristic already produces for the same schema."""

    def test_all_widget_ids_unique_for_a_full_rolplay_schema(self):
        schema = NormalizedSchema(company="Siigo", slug="siigo", modules=["coach", "simulator"], metrics=[
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="category", label="Category", type=MetricType.dimension,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        ])
        rows, _filters, _recs = _heuristic(schema, {m.key: m for m in schema.metrics})
        ids = [w.id for r in rows for w in r.widgets]
        self.assertEqual(len(ids), len(set(ids)), f"duplicate widget ids: {ids}")


if __name__ == "__main__":
    unittest.main()
