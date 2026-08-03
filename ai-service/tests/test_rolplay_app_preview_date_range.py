"""Regression tests for preview_fetch.py's rolplay_app_sql date-range gap +
the 3 parity fixes it enabled (KPI deltas, Best Performers, daily pass/fail).

Found via a full audit against the real ERD and lib/bridge-rolplay-app.ts
(the hand-built reference): _rolplay_app's shared query base applied NO date
bound at all, on every widget type -- cfg.connector_handle["date_range"] (the
tenant's own discovered window) and the declared date_range DashboardFilter
were both silently ignored by every query. Every rolplayApp* adapter in
lib/bridge-rolplay-app.ts applies dateClause() to every query; this connector
matches that now.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.models import DashboardConfig, ServiceKind, WidgetConfig, WidgetType
from app.preview_fetch import (
    BEST_PERFORMERS_ID,
    DAILY_PASSFAIL_ID,
    fetch_widget,
)


def _run(coro):
    return asyncio.run(coro)


def _cfg(date_range=("2025-10-01", "2025-12-31")) -> DashboardConfig:
    handle = {"client_id": 29}
    if date_range:
        handle["date_range"] = list(date_range)
    return DashboardConfig(
        company="Siigo", slug="siigo", title="Siigo Analytics",
        connector=ServiceKind.rolplay_app_sql, connector_handle=handle,
    )


def _widget(type_: WidgetType, id_: str, metric_key: str | None = None, **extra) -> WidgetConfig:
    return WidgetConfig(
        id=id_, type=type_, title="t", metric_key=metric_key,
        source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session", **extra,
    )


class DateRangeAppliedTests(unittest.TestCase):
    """Every query branch must now carry a BETWEEN bound built from the
    discovered date_range, not silently query all-time."""

    def _captured_sql(self, widget: WidgetConfig, date_range=("2025-10-01", "2025-12-31")) -> list[str]:
        calls: list[str] = []

        async def fake_sql(_url, payload):
            calls.append(payload["sql"])
            return 200, {"data": []}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            _run(fetch_widget(_cfg(date_range), widget))
        return calls

    def test_kpi_tile_applies_date_clause(self):
        sql = self._captured_sql(_widget(WidgetType.kpi_tile, "tile_total_sessions", "total_sessions"))[0]
        self.assertIn("BETWEEN '2025-10-01 00:00:00' AND '2025-12-31 23:59:59'", sql)

    def test_breakdown_table_applies_date_clause(self):
        sql = self._captured_sql(_widget(WidgetType.table, "table_breakdown"))[0]
        self.assertIn("BETWEEN '2025-10-01 00:00:00' AND '2025-12-31 23:59:59'", sql)

    def test_line_chart_trend_applies_date_clause(self):
        sql = self._captured_sql(_widget(WidgetType.line_chart, "chart_trend"))[0]
        self.assertIn("BETWEEN '2025-10-01 00:00:00' AND '2025-12-31 23:59:59'", sql)

    def test_histogram_applies_date_clause(self):
        sql = self._captured_sql(_widget(WidgetType.histogram, "chart_histogram"))[0]
        self.assertIn("BETWEEN '2025-10-01 00:00:00' AND '2025-12-31 23:59:59'", sql)

    def test_reports_table_applies_date_clause(self):
        sql = self._captured_sql(_widget(WidgetType.table, "table_reports"))[0]
        self.assertIn("BETWEEN '2025-10-01 00:00:00' AND '2025-12-31 23:59:59'", sql)

    def test_no_date_range_discovered_falls_back_to_wide_default_not_unbounded(self):
        """No silent 'skip the clause' path -- absent a discovered window,
        every query still gets the configured wide-default bound applied."""
        sql = self._captured_sql(_widget(WidgetType.kpi_tile, "tile_total_sessions", "total_sessions"), date_range=None)[0]
        self.assertIn("BETWEEN '2015-01-01 00:00:00' AND '2035-12-31 23:59:59'", sql)

    def test_journey_deliberately_stays_all_time(self):
        """The journey widget shows which stages a tenant has EVER reached --
        windowing it to the current range could make a real stage vanish."""
        calls: list[str] = []

        async def fake_sql(_url, payload):
            calls.append(payload["sql"])
            return 200, {"data": [{"category": "SIM", "total_sessions": 5, "passed_sessions": 3, "pass_rate": 60}]}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            _run(fetch_widget(_cfg(), _widget(WidgetType.journey, "journey")))
        self.assertNotIn("BETWEEN", calls[0])


class KpiDeltaTests(unittest.TestCase):
    """Period-over-period comparison mirroring rolplayAppOverview's
    prevTotalEvaluations/prevAvgScore/prevPassRate + lib/kpi-builder.ts's
    calcDeltaPct -- confirmed entirely absent from the AI-generated dashboard
    before this fix (WidgetPreview had no field for it at all)."""

    def _run_kpi(self, metric_key: str, cur_row: dict, prev_row: dict):
        calls = {"n": 0}

        async def fake_sql(_url, payload):
            calls["n"] += 1
            sql = payload["sql"]
            # First call = current period (frm/to), second = previous period.
            row = cur_row if calls["n"] == 1 else prev_row
            return 200, {"data": [row]}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, f"tile_{metric_key}", metric_key)))
        return pv, calls["n"]

    def test_total_sessions_delta_computed_against_previous_equal_length_window(self):
        pv, n = self._run_kpi(
            "total_sessions",
            {"sessions": 150, "users": 10, "avg_score": 80, "passed": 100},
            {"sessions": 100, "users": 8, "avg_score": 70, "passed": 60},
        )
        self.assertEqual(n, 2, "expected a current-period query and a previous-period query")
        self.assertEqual(pv.value, 150)
        self.assertEqual(pv.prev_value, 100)
        self.assertEqual(pv.delta_pct, 50)  # (150-100)/100*100

    def test_avg_score_delta_computed(self):
        pv, _ = self._run_kpi(
            "avg_score",
            {"sessions": 150, "users": 10, "avg_score": 80, "passed": 100},
            {"sessions": 100, "users": 8, "avg_score": 40, "passed": 60},
        )
        self.assertEqual(pv.value, 80.0)
        self.assertEqual(pv.prev_value, 40.0)
        self.assertEqual(pv.delta_pct, 100)  # (80-40)/40*100

    def test_no_delta_for_total_users_metric(self):
        """total_users has no previous-period comparison in the hand-built
        app either (rolplayAppOverview doesn't track it) -- must stay None,
        not a fabricated 0%."""
        pv, n = self._run_kpi(
            "total_users",
            {"sessions": 150, "users": 10, "avg_score": 80, "passed": 100},
            {"sessions": 100, "users": 8, "avg_score": 70, "passed": 60},
        )
        self.assertEqual(n, 1, "no previous-period query should run for a metric with no delta")
        self.assertIsNone(pv.prev_value)
        self.assertIsNone(pv.delta_pct)

    def test_zero_previous_value_yields_no_fabricated_delta(self):
        pv, _ = self._run_kpi(
            "total_sessions",
            {"sessions": 50, "users": 5, "avg_score": 80, "passed": 40},
            {"sessions": 0, "users": 0, "avg_score": None, "passed": 0},
        )
        self.assertEqual(pv.prev_value, 0)
        self.assertIsNone(pv.delta_pct)


class BestPerformersTests(unittest.TestCase):
    """Leaderboard mirroring rolplayAppBestPerformers exactly -- confirmed
    entirely missing from every AI-generated rolplay_app_sql dashboard, even
    though it's a prominent Trophy-icon card on every hand-built Overview."""

    def test_returns_ranked_rows_with_expected_shape(self):
        rows_in = [
            {"email": "a@x.com", "name": " Alice ", "sessions": 20, "avg_score": 91.2, "passed": 18},
            {"email": "b@x.com", "name": None, "sessions": 15, "avg_score": 85.0, "passed": 10},
        ]

        async def fake_sql(_url, payload):
            self.assertIn("HAVING COUNT(", payload["sql"])
            self.assertIn("ORDER BY avg_score DESC, sessions DESC", payload["sql"])
            self.assertIn("LIMIT 10", payload["sql"])
            return 200, {"data": rows_in}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), _widget(WidgetType.table, BEST_PERFORMERS_ID)))

        self.assertTrue(pv.ok)
        self.assertEqual(pv.rows[0]["user_email"], "a@x.com")
        self.assertEqual(pv.rows[0]["user_name"], "Alice")
        self.assertEqual(pv.rows[0]["pass_rate"], 90.0)
        self.assertIsNone(pv.rows[1]["user_name"])

    def test_no_data_reports_empty_not_crash(self):
        async def fake_sql(_url, _payload):
            return 200, {"data": []}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), _widget(WidgetType.table, BEST_PERFORMERS_ID)))
        self.assertFalse(pv.ok)
        self.assertEqual(pv.rows, [])


class DailyPassFailTests(unittest.TestCase):
    """Daily session volume + passed count, mirroring rolplayAppTrends'
    evalCountTrend/passFailTrend -- the existing line_chart trend only ever
    exposed avg score, never a daily pass/fail breakdown."""

    def test_returns_daily_rows_with_sessions_and_passed(self):
        rows_in = [
            {"day": "2025-11-01", "sessions": 12, "passed": 9},
            {"day": "2025-11-02", "sessions": 5, "passed": 2},
        ]

        async def fake_sql(_url, _payload):
            return 200, {"data": rows_in}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), _widget(WidgetType.bar_chart, DAILY_PASSFAIL_ID)))

        self.assertTrue(pv.ok)
        self.assertEqual(pv.rows, [
            {"date": "2025-11-01", "sessions": 12, "passed": 9},
            {"date": "2025-11-02", "sessions": 5, "passed": 2},
        ])


if __name__ == "__main__":
    unittest.main()
