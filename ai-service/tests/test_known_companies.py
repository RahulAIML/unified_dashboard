"""Regression test for GET /ai/known-companies -- lets the dashboard-builder
UI offer a company picker for rolplay_app_sql instead of pure free-text entry
(the user asked for a "drilldown to select the company"). rolplay_app_sql
only, matching every other connector-specific fix in this project.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.routes.ai import known_companies


def _run(coro):
    return asyncio.run(coro)


class KnownCompaniesTests(unittest.TestCase):
    def test_returns_real_rows_shaped_for_the_picker(self):
        rows = [
            {"id": 29, "name": "Siigo", "created_on": "2026-06-22 19:28:46", "sessions": 144, "users": 64},
            {"id": 1, "name": "amit client", "created_on": "2026-01-08 09:37:47", "sessions": 0, "users": 19},
        ]
        with patch("app.connectors.rolplay_app.RolplayAppConnector._sql", new=AsyncMock(return_value=rows)):
            result = _run(known_companies())
        self.assertEqual(result, rows)

    def test_created_on_is_passed_through_for_the_picker_new_badge(self):
        rows = [{"id": 39, "name": "Mastercard", "created_on": "2026-08-17 21:05:02", "sessions": 0, "users": 0}]
        with patch("app.connectors.rolplay_app.RolplayAppConnector._sql", new=AsyncMock(return_value=rows)):
            result = _run(known_companies())
        self.assertEqual(result[0]["created_on"], "2026-08-17 21:05:02")

    def test_missing_created_on_degrades_to_none_not_an_error(self):
        rows = [{"id": 10, "name": "Old client", "sessions": 3, "users": 1}]  # row with no created_on key at all
        with patch("app.connectors.rolplay_app.RolplayAppConnector._sql", new=AsyncMock(return_value=rows)):
            result = _run(known_companies())
        self.assertIsNone(result[0]["created_on"])

    def test_no_rows_returns_empty_list_not_an_error(self):
        with patch("app.connectors.rolplay_app.RolplayAppConnector._sql", new=AsyncMock(return_value=None)):
            result = _run(known_companies())
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
