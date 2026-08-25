"""HTTP-layer tests for /ai/render/{slug}'s new caching (app/cache.py) —
every dashboard VIEW (builder preview and the published /d/[slug] page
alike) hit this endpoint, and every widget's live query re-ran from scratch
on every single call before this. Cached for a short TTL, keyed on the
config's own `version` so a republish (which always increments it) busts
the cache naturally, without any explicit invalidation call needed.
"""
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app import cache
from app.main import app
from app.models import DashboardConfig, DashboardPreview, ServiceKind


class RenderEndpointCacheTests(unittest.TestCase):
    def setUp(self):
        cache._redis_client = None
        cache._redis_attempted = False
        cache._memory_store.clear()

    def tearDown(self):
        cache._redis_client = None
        cache._redis_attempted = False
        cache._memory_store.clear()

    def _cfg(self, version=1):
        return DashboardConfig(company="Siigo", slug="siigo", title="Siigo Analytics",
                               connector=ServiceKind.rolplay_app_sql, version=version)

    def test_second_call_reuses_the_cache_not_a_second_preview_run(self):
        calls = {"n": 0}

        async def fake_preview_run(cfg, log):
            calls["n"] += 1
            return DashboardPreview(slug=cfg.slug, widgets=[])

        with patch("app.routes.ai._load_config", new=AsyncMock(return_value=self._cfg())), \
             patch("app.agents.preview.run", new=fake_preview_run):
            client = TestClient(app)
            first = client.get("/ai/render/siigo")
            second = client.get("/ai/render/siigo")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(calls["n"], 1, "expected preview.run to be called exactly once, not once per request")

    def test_a_new_published_version_is_not_served_stale_cached_data(self):
        calls = {"n": 0}

        async def fake_preview_run(cfg, log):
            calls["n"] += 1
            return DashboardPreview(slug=cfg.slug, widgets=[])

        with patch("app.routes.ai._load_config", new=AsyncMock(return_value=self._cfg(version=1))), \
             patch("app.agents.preview.run", new=fake_preview_run):
            client = TestClient(app)
            client.get("/ai/render/siigo")

        with patch("app.routes.ai._load_config", new=AsyncMock(return_value=self._cfg(version=2))), \
             patch("app.agents.preview.run", new=fake_preview_run):
            client.get("/ai/render/siigo")

        self.assertEqual(calls["n"], 2, "a version bump (every publish) must bust the cache, not reuse v1's result")

    def test_404_for_an_unpublished_slug_is_never_cached(self):
        with patch("app.routes.ai._load_config", new=AsyncMock(return_value=None)):
            client = TestClient(app)
            resp = client.get("/ai/render/nobody")
        self.assertEqual(resp.status_code, 404)

    def test_a_render_with_a_failed_widget_gets_a_much_shorter_ttl_than_a_full_success(self):
        """Found live: a single transient hiccup (a bridge timing out once)
        got cached as a blank KPI tile for the FULL 30s TTL, freezing every
        viewer in that window onto the same failure even though a retry
        moments later would have succeeded. A render with any failed widget
        must expire much sooner so it can self-heal."""
        import time

        from app.models import WidgetPreview
        from app.routes.ai import _RENDER_CACHE_TTL_SECONDS, _RENDER_FAILURE_CACHE_TTL_SECONDS

        async def fake_preview_run_ok(cfg, log):
            return DashboardPreview(slug=cfg.slug, widgets=[])

        async def fake_preview_run_failed(cfg, log):
            return DashboardPreview(slug=cfg.slug, widgets=[WidgetPreview(widget_id="w1", ok=False, error="boom")])

        with patch("app.routes.ai._load_config", new=AsyncMock(return_value=self._cfg(version=1))), \
             patch("app.agents.preview.run", new=fake_preview_run_ok):
            TestClient(app).get("/ai/render/siigo")
        ok_expiry, _ = cache._memory_store["render:siigo:v1"]
        cache._memory_store.clear()

        with patch("app.routes.ai._load_config", new=AsyncMock(return_value=self._cfg(version=1))), \
             patch("app.agents.preview.run", new=fake_preview_run_failed):
            TestClient(app).get("/ai/render/siigo")
        failed_expiry, _ = cache._memory_store["render:siigo:v1"]

        now = time.monotonic()
        self.assertLessEqual(failed_expiry - now, _RENDER_FAILURE_CACHE_TTL_SECONDS + 0.5)
        self.assertGreater(ok_expiry - now, _RENDER_FAILURE_CACHE_TTL_SECONDS + 0.5)
        self.assertEqual(_RENDER_CACHE_TTL_SECONDS, 30)


if __name__ == "__main__":
    unittest.main()
