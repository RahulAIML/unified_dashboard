"""Regression tests for composing a SECONDARY connector's data instead of
silently dropping it.

Found live: Besins matched both rolplay_app_sql (client_id, 3 sessions,
strong name-match) and coach_app_sql (customer_id, 17 real sessions, weaker
domain-match). pick_primary correctly keeps rolplay_app_sql as primary (the
same match-confidence reasoning already verified correct for Takeda) -- but
before this, the secondary's 17 real sessions never appeared anywhere. These
tests pin the two pieces that make composing it actually work end to end:
dashboard_config.py merging the secondary's connector handle in alongside
the primary's, and preview_fetch.py fetching a secondary-page widget from
the RIGHT connector rather than force-routing it through the primary's.
"""
import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import dashboard_config
from app.config import get_settings
from app.preview_fetch import fetch_widget
from app.models import (
    CompanyKnowledge,
    DashboardFilter,
    DashboardPage,
    NormalizedSchema,
    ServiceDescriptor,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)


def _run(coro):
    return asyncio.run(coro)


async def _noop_log(*_args):
    return None


class DashboardConfigSecondaryHandleTests(unittest.TestCase):
    def test_merges_secondary_handle_without_overwriting_primary_keys(self):
        knowledge = CompanyKnowledge(company="Besins", slug="besins")
        schema = NormalizedSchema(company="Besins", slug="besins")
        primary = ServiceDescriptor(
            kind=ServiceKind.rolplay_app_sql, name="rolplay_app", base_url="x",
            has_data=True, handle={"client_id": 11},
        )
        secondary = ServiceDescriptor(
            kind=ServiceKind.coach_app_sql, name="coach_app", base_url="x",
            has_data=True, handle={"customer_id": 16, "domain": "besins.com"},
        )
        cfg = _run(dashboard_config.run(
            knowledge, schema, primary, [DashboardPage(id="overview", title="Overview")],
            [], [], _noop_log, secondary=secondary,
        ))
        self.assertEqual(cfg.connector_handle["client_id"], 11)
        self.assertEqual(cfg.connector_handle["customer_id"], 16)

    def test_primary_key_wins_on_a_genuine_collision(self):
        knowledge = CompanyKnowledge(company="X", slug="x")
        schema = NormalizedSchema(company="X", slug="x")
        primary = ServiceDescriptor(kind=ServiceKind.rolplay_app_sql, name="a", base_url="x",
                                    has_data=True, handle={"domain": "primary.test"})
        secondary = ServiceDescriptor(kind=ServiceKind.coach_app_sql, name="b", base_url="x",
                                      has_data=True, handle={"domain": "secondary.test"})
        cfg = _run(dashboard_config.run(
            knowledge, schema, primary, [DashboardPage(id="overview", title="Overview")],
            [], [], _noop_log, secondary=secondary,
        ))
        self.assertEqual(cfg.connector_handle["domain"], "primary.test")

    def test_no_secondary_leaves_handle_unchanged(self):
        knowledge = CompanyKnowledge(company="X", slug="x")
        schema = NormalizedSchema(company="X", slug="x")
        primary = ServiceDescriptor(kind=ServiceKind.rolplay_app_sql, name="a", base_url="x",
                                    has_data=True, handle={"client_id": 5})
        cfg = _run(dashboard_config.run(
            knowledge, schema, primary, [DashboardPage(id="overview", title="Overview")], [], [], _noop_log,
        ))
        self.assertEqual(cfg.connector_handle["client_id"], 5)
        self.assertNotIn("customer_id", cfg.connector_handle)


class DashboardConfigBrandingTests(unittest.TestCase):
    """dashboard_config.py previously hardcoded branding={"primary_color":
    "#DC2626"} for every tenant. It now checks branding_lookup.py first and
    only falls back to that default when nothing real is saved."""

    def _cfg(self, domains):
        knowledge = CompanyKnowledge(company="Apotex", slug="apotex", domains=domains)
        schema = NormalizedSchema(company="Apotex", slug="apotex")
        primary = ServiceDescriptor(kind=ServiceKind.pharma_kpi, name="a", base_url="x", has_data=True)
        return knowledge, schema, primary

    def test_falls_back_to_the_default_when_nothing_is_saved(self):
        knowledge, schema, primary = self._cfg(["apotex.com"])
        with patch("app.agents.dashboard_config.lookup_tenant_branding", new=AsyncMock(return_value=None)):
            cfg = _run(dashboard_config.run(
                knowledge, schema, primary, [DashboardPage(id="overview", title="Overview")], [], [], _noop_log,
            ))
        self.assertEqual(cfg.branding["primary_color"], "#DC2626")

    def test_uses_the_real_saved_branding_when_present(self):
        knowledge, schema, primary = self._cfg(["apotex.com"])
        real = {"primary_color": "#123456", "secondary_color": "#000000", "accent_color": None, "logo_url": None}
        with patch("app.agents.dashboard_config.lookup_tenant_branding", new=AsyncMock(return_value=real)):
            cfg = _run(dashboard_config.run(
                knowledge, schema, primary, [DashboardPage(id="overview", title="Overview")], [], [], _noop_log,
            ))
        self.assertEqual(cfg.branding["primary_color"], "#123456")
        self.assertEqual(cfg.branding["secondary_color"], "#000000")
        # Null fields from the DB row must not blank out the default.
        self.assertNotIn("accent_color", cfg.branding)


class SecondaryWidgetFetchDispatchTests(unittest.TestCase):
    """The exact Besins shape: cfg.connector is rolplay_app_sql, but a
    secondary-page widget's source_kind is coach_app_sql -- it must be
    fetched via CoachAppConnector, not misrouted through _rolplay_app."""

    def setUp(self):
        os.environ["BRIDGE_URL"] = "https://bridge.test/exec"
        os.environ["BRIDGE_SECRET"] = "test-secret"
        get_settings.cache_clear()

    def tearDown(self):
        os.environ.pop("BRIDGE_URL", None)
        os.environ.pop("BRIDGE_SECRET", None)
        get_settings.cache_clear()

    def _besins_cfg(self):
        from app.models import DashboardConfig
        return DashboardConfig(
            company="Besins", slug="besins", title="Besins Analytics",
            connector=ServiceKind.rolplay_app_sql,
            connector_handle={"client_id": 11, "customer_id": 16},
        )

    def test_secondary_widget_is_fetched_via_coach_app_not_rolplay_app(self):
        widget = WidgetConfig(
            id="secondary_coach_app_sql_tile_total_sessions", type=WidgetType.kpi_tile,
            title="Total Sessions", metric_key="total_sessions",
            source_kind=ServiceKind.coach_app_sql, source_action="report_field_current",
        )
        row = {"total_sessions": 17, "avg_score": "60.00", "passed": 10}
        with patch("app.connectors.coach_app.post_json", new=AsyncMock(return_value=(200, {"success": True, "data": [row]}))):
            preview = _run(fetch_widget(self._besins_cfg(), widget))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 17)

    def test_primary_widget_on_the_same_config_still_uses_rolplay_app(self):
        # Sanity check the dispatch change didn't break the OTHER widgets on
        # the exact same (now dual-source) config.
        widget = WidgetConfig(
            id="tile_total_sessions", type=WidgetType.kpi_tile, title="Total Sessions",
            metric_key="total_sessions", source_kind=ServiceKind.rolplay_app_sql,
            source_action="r_user_session",
        )
        async def fake_sql(url, body, headers=None):
            return 200, {"data": [{"sessions": 3, "users": 3, "avg_score": None, "passed": 0}]}
        with patch("app.preview_fetch.post_json", new=fake_sql):
            preview = _run(fetch_widget(self._besins_cfg(), widget))

        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 3)


if __name__ == "__main__":
    unittest.main()
