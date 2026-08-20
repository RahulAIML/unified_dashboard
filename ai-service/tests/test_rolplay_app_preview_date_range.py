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
    REPORTS_TABLE_ID,
    _prev_period,
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

    def test_negligible_previous_value_yields_no_fabricated_delta(self):
        """A prior period with 5 sessions vs. a current 514 is a technically
        correct but meaningless "+10180%" -- observed live on a real
        published dashboard (M8 Cliente) during Dashboard Builder
        validation. Any swing over 999% must be suppressed, same as the
        prev==0 case, rather than shown as an actionable trend."""
        pv, _ = self._run_kpi(
            "total_sessions",
            {"sessions": 514, "users": 49, "avg_score": 80, "passed": 400},
            {"sessions": 5, "users": 2, "avg_score": 80, "passed": 4},
        )
        self.assertEqual(pv.prev_value, 5)
        self.assertIsNone(pv.delta_pct)


class BestPerformersTests(unittest.TestCase):
    """Leaderboard mirroring rolplayAppBestPerformers exactly -- confirmed
    entirely missing from every AI-generated rolplay_app_sql dashboard, even
    though it's a prominent Trophy-icon card on every hand-built Overview."""

    def test_returns_ranked_rows_with_expected_shape(self):
        rows_in = [
            {"email": "a@x.com", "name": " Alice ", "sessions": 20, "scored": 20, "avg_score": 91.2, "passed": 18},
            {"email": "b@x.com", "name": None, "sessions": 15, "scored": 15, "avg_score": 85.0, "passed": 10},
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

    def test_pass_rate_divides_by_scored_sessions_not_total(self):
        """Regression: pass_rate used to divide `passed` by `sessions` (every
        session, scored or not), diverging from lib/bridge-rolplay-app.ts's
        rolplayAppBestPerformers (which correctly divides by `scored`) and
        understating pass_rate for any user with unscored sessions mixed in."""
        rows_in = [
            # 20 total sessions, only 18 scored, all 18 scored ones passed --
            # correct pass_rate is 100% (18/18), not the old buggy 90% (18/20).
            {"email": "a@x.com", "name": "Alice", "sessions": 20, "scored": 18, "avg_score": 95.0, "passed": 18},
        ]

        async def fake_sql(_url, _payload):
            return 200, {"data": rows_in}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), _widget(WidgetType.table, BEST_PERFORMERS_ID)))

        self.assertEqual(pv.rows[0]["pass_rate"], 100.0)

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


class ReportsTableResultLabelTests(unittest.TestCase):
    """Regression: a session with no extractable score at all (SCORE_SQL
    NULL) used to fall through a plain CASE/ELSE to 'Failed' -- NULL >= 70 is
    unknown, not false, in SQL. Fixed to emit NULL/unknown for that case,
    matching lib/bridge-rolplay-app.ts's _rolplayAppResultsImpl
    (`score != null ? (passed ? 'pass' : 'fail') : null`)."""

    def test_sql_emits_null_result_for_a_null_score_instead_of_failed(self):
        calls: list[str] = []

        async def fake_sql(_url, payload):
            calls.append(payload["sql"])
            return 200, {"data": []}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            _run(fetch_widget(_cfg(), _widget(WidgetType.table, REPORTS_TABLE_ID)))

        sql = calls[0]
        self.assertIn("WHEN", sql)
        self.assertIn("IS NULL THEN NULL", sql)
        # The NULL-check branch must come before the pass/fail branches so it
        # actually wins for a NULL score (CASE takes the first matching WHEN).
        null_branch_idx = sql.index("IS NULL THEN NULL")
        passed_branch_idx = sql.index("THEN 'Passed'")
        self.assertLess(null_branch_idx, passed_branch_idx)


class TrendSessionCountTests(unittest.TestCase):
    """Regression: the monthly trend line's `sessions` count used to come
    from a query with `WHERE sc IS NOT NULL` on the OUTER aggregate, which
    dropped unscored sessions from the session-volume count itself, not just
    from the average-score calculation -- undercounting relative to
    lib/bridge-rolplay-app.ts's trend (which counts every real session
    unconditionally). AVG(sc) already ignores NULLs on its own."""

    def test_session_count_query_has_no_outer_not_null_score_filter(self):
        calls: list[str] = []

        async def fake_sql(_url, payload):
            calls.append(payload["sql"])
            return 200, {"data": []}

        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            _run(fetch_widget(_cfg(), _widget(WidgetType.line_chart, "chart_trend")))

        sql = calls[0]
        # The outer aggregate (GROUP BY period) must not filter by sc at all --
        # only the inner subquery computes sc; the outer query should count
        # every row from it unconditionally.
        outer_query = sql.split(") t ", 1)[1]
        self.assertNotIn("sc IS NOT NULL", outer_query)


class PrevPeriodBoundaryTests(unittest.TestCase):
    """Regression: _prev_period used to return prev_to == frm exactly, and
    _sql_date_clause pads a date-only bound to a full day (00:00:00..
    23:59:59) on both ends -- so the ENTIRE calendar day `frm` was counted
    in both the current period (which starts at `frm 00:00:00`) and the
    "previous" period (which ended at `frm 23:59:59`). For a typical 7-30
    day dashboard window this is a real, material double-count (e.g. 1 of 7
    days for a weekly range), not a one-instant edge case."""

    def test_previous_period_ends_the_day_before_the_current_period_starts(self):
        prev_from, prev_to = _prev_period("2026-06-08", "2026-06-14")
        self.assertEqual(prev_to, "2026-06-07")

    def test_previous_period_is_the_same_length_as_the_current_one(self):
        # Current period: 2026-06-08 .. 2026-06-14, a 7-day inclusive span
        # (8,9,10,11,12,13,14). The previous period must be the same 7-day
        # length, ending the day before: 2026-06-01 .. 2026-06-07
        # (1,2,3,4,5,6,7).
        prev_from, prev_to = _prev_period("2026-06-08", "2026-06-14")
        self.assertEqual((prev_from, prev_to), ("2026-06-01", "2026-06-07"))

    def test_none_for_an_invalid_or_inverted_range(self):
        self.assertIsNone(_prev_period("not-a-date", "2026-06-14"))
        self.assertIsNone(_prev_period("2026-06-14", "2026-06-08"))  # to before from


if __name__ == "__main__":
    unittest.main()
