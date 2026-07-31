"""Regression test for the internal-shared-secret gate on /ai/*.

This service is deployed on Render as `type: web` (render.yaml) — a public
web service, not a private/internal one — and had NO authentication of its
own: CORS (app/main.py) only constrains browser-originated requests, never a
direct server-to-server or curl call to the service's own URL. Every route
under /ai/* provisions tenants, generates/publishes dashboards, or reads
company analytics data, so anyone who found this service's Render URL could
call generate-dashboard/publish/knowledge-delete directly, bypassing the
Next.js proxy's admin gate (app/api/ai/[...path]/route.ts) entirely.

require_internal_secret is unenforced when unset (the dev default) so a local
checkout keeps working without configuring it, and enforced (401 on mismatch)
once INTERNAL_SHARED_SECRET is set — matching the existing BRIDGE_SECRET /
ROLPLAY_APP_SQL_TOKEN pattern already used elsewhere in this codebase.
"""
import os
import unittest

from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


class InternalAuthGateTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("INTERNAL_SHARED_SECRET", None)
        get_settings.cache_clear()

    def test_unenforced_when_secret_is_unset(self):
        os.environ.pop("INTERNAL_SHARED_SECRET", None)
        get_settings.cache_clear()
        client = TestClient(app)

        resp = client.get("/ai/health")

        self.assertEqual(resp.status_code, 200)

    def test_rejects_missing_header_once_secret_is_configured(self):
        os.environ["INTERNAL_SHARED_SECRET"] = "test-secret"
        get_settings.cache_clear()
        client = TestClient(app)

        resp = client.get("/ai/health")

        self.assertEqual(resp.status_code, 401)

    def test_rejects_wrong_header_value(self):
        os.environ["INTERNAL_SHARED_SECRET"] = "test-secret"
        get_settings.cache_clear()
        client = TestClient(app)

        resp = client.get("/ai/health", headers={"X-Internal-Auth": "wrong"})

        self.assertEqual(resp.status_code, 401)

    def test_accepts_correct_header_value(self):
        os.environ["INTERNAL_SHARED_SECRET"] = "test-secret"
        get_settings.cache_clear()
        client = TestClient(app)

        resp = client.get("/ai/health", headers={"X-Internal-Auth": "test-secret"})

        self.assertEqual(resp.status_code, 200)

    def test_gates_a_mutating_route_too_not_just_health(self):
        os.environ["INTERNAL_SHARED_SECRET"] = "test-secret"
        get_settings.cache_clear()
        client = TestClient(app)

        resp = client.post("/ai/generate-dashboard", json={"company": "Acme"})

        self.assertEqual(resp.status_code, 401)

    def test_root_health_check_is_unaffected(self):
        # Render's healthCheckPath is root /health (main.py), not under the
        # /ai router — must stay reachable regardless of the secret, since
        # Render's own health prober doesn't send this header.
        os.environ["INTERNAL_SHARED_SECRET"] = "test-secret"
        get_settings.cache_clear()
        client = TestClient(app)

        resp = client.get("/health")

        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
