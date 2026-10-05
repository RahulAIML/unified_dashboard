"""Regression tests for app/lms.py — a port of lib/lms-learnworlds.ts's
aggregation logic. LMS is tested as its own module here (credential
resolution is already covered by test_tenant_credentials.py) — these tests
pin down the AGGREGATION being numerically identical to the TS version for a
known input, since a silent divergence here would show wrong LMS numbers to
a real tenant with no visible error.
"""
import asyncio
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app import lms


def _days_ago(n: int) -> tuple[float, str]:
    """(unix seconds, UTC date key) for a moment n days before now -- matches
    _to_date_key()'s own bucketing."""
    dt = datetime.now(timezone.utc) - timedelta(days=n)
    return dt.timestamp(), dt.strftime("%Y-%m-%d")


def _run(coro):
    return asyncio.run(coro)


class OriginParsingTests(unittest.TestCase):
    def test_strips_a_path_down_to_the_origin(self):
        self.assertEqual(lms._origin_from("https://academiaapotex.learnworlds.com/admin/api/"), "https://academiaapotex.learnworlds.com")

    def test_adds_https_when_scheme_is_missing(self):
        self.assertEqual(lms._origin_from("academiaapotex.learnworlds.com"), "https://academiaapotex.learnworlds.com")

    def test_returns_none_for_garbage_input(self):
        self.assertIsNone(lms._origin_from("://///"))


class CredentialsFromBundleTests(unittest.TestCase):
    """Confirmed live in production against a real stored Apotex credential:
    httpx raises 'Illegal header value' on an access_token with a trailing
    newline, while Node's fetch (the working TS LMS integration) tolerates
    it. _credentials_from_bundle must sanitize every field it hands back,
    since those values go straight into an Authorization header."""

    def test_strips_trailing_newline_from_access_token(self):
        creds = lms._credentials_from_bundle({
            "api_url": "https://academiaapotex.learnworlds.com",
            "access_token": "nbgl2ngCCYbUtwbHW8bYmcyYhlI2dQuVTNZN9G7g\n",
        })
        self.assertEqual(creds.access_token, "nbgl2ngCCYbUtwbHW8bYmcyYhlI2dQuVTNZN9G7g")

    def test_strips_whitespace_from_client_id_and_secret(self):
        creds = lms._credentials_from_bundle({
            "api_url": "https://x.learnworlds.com",
            "client_id": " cid \n",
            "client_secret": "\tsecret\r\n",
        })
        self.assertEqual(creds.client_id, "cid")
        self.assertEqual(creds.client_secret, "secret")

    def test_strips_whitespace_from_api_url(self):
        creds = lms._credentials_from_bundle({
            "api_url": " https://x.learnworlds.com/admin/api/ \n",
            "access_token": "tok",
        })
        self.assertEqual(creds.origin, "https://x.learnworlds.com")

    def test_none_when_access_token_is_only_whitespace(self):
        self.assertIsNone(lms._credentials_from_bundle({
            "api_url": "https://x.learnworlds.com",
            "access_token": "   \n",
        }))


class DateKeyTests(unittest.TestCase):
    def test_unix_seconds(self):
        self.assertEqual(lms._to_date_key(1700000000), "2023-11-14")

    def test_unix_millis(self):
        self.assertEqual(lms._to_date_key(1700000000000), "2023-11-14")

    def test_iso_string(self):
        self.assertEqual(lms._to_date_key("2023-11-14T10:00:00Z"), "2023-11-14")

    def test_none_and_empty(self):
        self.assertIsNone(lms._to_date_key(None))
        self.assertIsNone(lms._to_date_key(""))


class LmsDashboardEmptyStateTests(unittest.TestCase):
    def test_returns_empty_lms_when_no_credentials(self):
        with patch("app.lms.resolve_lms_credentials", new=AsyncMock(return_value=None)):
            result = _run(lms.lms_dashboard("no-lms-tenant", "2023-11-01", "2023-11-30"))
        self.assertEqual(result, lms.EMPTY_LMS)
        self.assertFalse(result["configured"])


class LmsDashboardAggregationTests(unittest.TestCase):
    """A known, hand-computed input/output pair -- if the port drifts from the
    TS version's arithmetic, this fails with a concrete wrong number rather
    than passing silently."""

    def setUp(self):
        lms._cache.clear()
        lms._inflight.clear()
        self.creds = lms.LmsCredentials(origin="https://x.learnworlds.com", client_id="cid", client_secret="secret")

        courses = [{"id": "c1", "title": "Course One"}, {"id": "c2", "title": "Course Two"}]
        users = [{"id": "u1"}, {"id": "u2"}, {"id": "u3"}]
        progress = {
            "u1": [{"course_id": "c1", "status": "completed", "average_score_rate": 80, "completed_at": 1700000000}],
            "u2": [{"course_id": "c1", "status": "in_progress", "average_score_rate": 0}],
            "u3": [],
        }

        async def fake_api_get(creds, path):
            if path.startswith("/courses"):
                return {"data": courses, "meta": {"totalPages": 1}}
            if path.startswith("/users/"):
                uid = path.split("/")[2]
                return {"data": progress.get(uid, [])}
            if path.startswith("/users"):
                return {"data": users, "meta": {"totalPages": 1}}
            raise AssertionError(f"unexpected path {path}")

        self._patcher = patch("app.lms._api_get", new=AsyncMock(side_effect=fake_api_get))
        self._patcher.start()
        self._resolve_patcher = patch("app.lms.resolve_lms_credentials", new=AsyncMock(return_value=self.creds))
        self._resolve_patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._resolve_patcher.stop()

    def test_top_level_kpis(self):
        result = _run(lms.lms_dashboard("apotex", "2023-11-01", "2023-11-30"))
        self.assertTrue(result["configured"])
        self.assertEqual(result["enrolledUsers"], 2)   # u1, u2 have rows; u3 doesn't
        self.assertEqual(result["totalUsers"], 3)
        self.assertEqual(result["totalEnrollments"], 2)
        self.assertEqual(result["totalCourses"], 2)
        self.assertEqual(result["modulesCompleted"], 1)
        self.assertEqual(result["inProgress"], 1)
        self.assertEqual(result["notStarted"], 0)
        self.assertEqual(result["completionRate"], 16.7)  # 1 completed / (3 users x 2 courses = 6 possible)

    def test_avg_quiz_score_only_counts_positive_scores(self):
        result = _run(lms.lms_dashboard("apotex", "2023-11-01", "2023-11-30"))
        # u2's average_score_rate=0 is excluded (indistinguishable from
        # ungraded) -- only u1's 80 counts.
        self.assertEqual(result["avgQuizScore"], 80.0)
        self.assertTrue(result["hasScoreData"])

    def test_completion_trend_is_a_fixed_recent_window_independent_of_the_requested_range(self):
        # The trend is now a FIXED, always-current 30-day window (see
        # _build_lms_dashboard's trend_from_key/trend_to_key) -- mirrors the
        # identical fix in lib/lms-learnworlds.ts. A caller-supplied range
        # that would have EXCLUDED this recent completion under the old
        # range-filtered behavior (2023) must have zero effect now.
        epoch, date_key = _days_ago(3)

        async def fake_api_get(creds, path):
            if path.startswith("/courses"):
                return {"data": [{"id": "c1", "title": "Course One"}], "meta": {"totalPages": 1}}
            if path.startswith("/users/"):
                uid = path.split("/")[2]
                if uid == "u1":
                    return {"data": [{"course_id": "c1", "status": "completed", "average_score_rate": 80, "completed_at": epoch}]}
                return {"data": []}
            return {"data": [{"id": "u1"}, {"id": "u2"}], "meta": {"totalPages": 1}}

        with patch("app.lms._api_get", new=AsyncMock(side_effect=fake_api_get)):
            result = _run(lms.lms_dashboard("apotex", "2023-11-01", "2023-11-30"))
        self.assertEqual(result["completionTrend"], [{"date": date_key, "value": 1}])

    def test_completion_trend_excludes_a_completion_older_than_30_days(self):
        epoch, _ = _days_ago(45)

        async def fake_api_get(creds, path):
            if path.startswith("/courses"):
                return {"data": [{"id": "c1", "title": "Course One"}], "meta": {"totalPages": 1}}
            if path.startswith("/users/"):
                uid = path.split("/")[2]
                if uid == "u1":
                    return {"data": [{"course_id": "c1", "status": "completed", "average_score_rate": 80, "completed_at": epoch}]}
                return {"data": []}
            return {"data": [{"id": "u1"}, {"id": "u2"}], "meta": {"totalPages": 1}}

        with patch("app.lms._api_get", new=AsyncMock(side_effect=fake_api_get)):
            result = _run(lms.lms_dashboard("apotex", "2023-11-01", "2023-11-30"))
        self.assertEqual(result["completionTrend"], [])
        # Still counts toward the current-state total even though it falls
        # outside the trend's 30-day window.
        self.assertEqual(result["modulesCompleted"], 1)

    def test_course_rows_only_include_courses_with_real_enrollment(self):
        result = _run(lms.lms_dashboard("apotex", "2023-11-01", "2023-11-30"))
        # c2 has zero enrollment rows in the progress data and must not appear.
        course_ids = [c["courseId"] for c in result["courses"]]
        self.assertEqual(course_ids, ["c1"])
        c1 = result["courses"][0]
        self.assertEqual(c1["enrolled"], 2)
        self.assertEqual(c1["completed"], 1)
        self.assertEqual(c1["inProgress"], 1)
        self.assertEqual(c1["completionRate"], 33.3)  # 1 completed / 3 total users
        self.assertEqual(c1["totalUsers"], 3)
        self.assertEqual(c1["avgScore"], 80.0)
        self.assertEqual(c1["name"], "Course One")

    def test_a_users_progress_404_is_treated_as_no_progress_not_an_outage(self):
        async def flaky_api_get(creds, path):
            if path.startswith("/users/u2"):
                raise RuntimeError("404")
            if path.startswith("/courses"):
                return {"data": [{"id": "c1", "title": "Course One"}], "meta": {"totalPages": 1}}
            if path.startswith("/users/"):
                return {"data": [{"course_id": "c1", "status": "completed", "average_score_rate": 90, "completed_at": 1700000000}]}
            return {"data": [{"id": "u1"}, {"id": "u2"}], "meta": {"totalPages": 1}}

        with patch("app.lms._api_get", new=AsyncMock(side_effect=flaky_api_get)):
            result = _run(lms.lms_dashboard("apotex", "2023-11-01", "2023-11-30"))
        # u2's fetch raised -- must not crash the whole dashboard, and must not
        # count as an enrollment.
        self.assertEqual(result["enrolledUsers"], 1)
        self.assertEqual(result["totalEnrollments"], 1)


class LmsProbeTests(unittest.TestCase):
    def test_not_configured_without_credentials(self):
        with patch("app.lms.resolve_lms_credentials", new=AsyncMock(return_value=None)):
            result = _run(lms.lms_probe("no-lms"))
        self.assertFalse(result["configured"])
        self.assertFalse(result["alive"])

    def test_alive_with_a_reachable_school(self):
        creds = lms.LmsCredentials(origin="https://x.learnworlds.com", client_id="cid", client_secret="secret")
        with patch("app.lms.resolve_lms_credentials", new=AsyncMock(return_value=creds)):
            with patch("app.lms._api_get", new=AsyncMock(return_value={"meta": {"totalItems": 15}, "data": [{}]})):
                result = _run(lms.lms_probe("apotex"))
        self.assertTrue(result["configured"])
        self.assertTrue(result["alive"])
        self.assertEqual(result["courses"], 15)

    def test_configured_but_not_alive_on_api_error(self):
        creds = lms.LmsCredentials(origin="https://x.learnworlds.com", client_id="cid", client_secret="secret")
        with patch("app.lms.resolve_lms_credentials", new=AsyncMock(return_value=creds)):
            with patch("app.lms._api_get", new=AsyncMock(side_effect=RuntimeError("LMS GET /courses failed (401)"))):
                result = _run(lms.lms_probe("apotex"))
        self.assertTrue(result["configured"])
        self.assertFalse(result["alive"])


if __name__ == "__main__":
    unittest.main()
