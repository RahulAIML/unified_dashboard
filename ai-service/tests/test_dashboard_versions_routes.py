"""HTTP-layer tests for the new dashboard-versions endpoints (list + rollback).

Route module does `from .. import dashboard_versions` (imports the MODULE,
not the functions), so patching app.dashboard_versions.list_versions/
rollback_to directly takes effect -- no "patched the wrong namespace" trap
here, unlike a `from .foo import bar` import.
"""
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.models import DashboardConfig, ServiceKind


class DashboardVersionsListRouteTests(unittest.TestCase):
    def test_returns_the_versions_for_a_slug(self):
        fake_versions = [{"version": 2, "created_at": "2026-07-31T00:00:00Z"},
                         {"version": 1, "created_at": "2026-07-30T00:00:00Z"}]
        with patch("app.dashboard_versions.list_versions", new=AsyncMock(return_value=fake_versions)):
            client = TestClient(app)
            resp = client.get("/ai/dashboard-versions/besins")

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["slug"], "besins")
        self.assertEqual([v["version"] for v in body["versions"]], [2, 1])

    def test_empty_list_for_an_unknown_slug_not_an_error(self):
        with patch("app.dashboard_versions.list_versions", new=AsyncMock(return_value=[])):
            client = TestClient(app)
            resp = client.get("/ai/dashboard-versions/nobody")

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["versions"], [])


class DashboardVersionsRollbackRouteTests(unittest.TestCase):
    def _cfg(self, version=3):
        return DashboardConfig(company="Besins", slug="besins", title="Besins Analytics",
                               connector=ServiceKind.rolplay_app_sql, version=version)

    def test_rolls_back_and_returns_the_new_version_number(self):
        with patch("app.dashboard_versions.rollback_to", new=AsyncMock(return_value=self._cfg(version=3))):
            client = TestClient(app)
            resp = client.post("/ai/dashboard-versions/rollback", json={"slug": "besins", "version": 1})

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["restored_from_version"], 1)
        self.assertEqual(body["new_version"], 3)

    def test_404_for_a_version_that_does_not_exist(self):
        with patch("app.dashboard_versions.rollback_to", new=AsyncMock(return_value=None)):
            client = TestClient(app)
            resp = client.post("/ai/dashboard-versions/rollback", json={"slug": "besins", "version": 99})

        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
