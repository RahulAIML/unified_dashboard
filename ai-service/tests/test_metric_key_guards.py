"""Regression tests: an unrecognized/stale metric_key on a kpi_tile widget
must return an explicit error, never a silent None, a wrong-shaped `rows`
payload, or a wrong number borrowed from a different metric. Every one of
these was found live to render as a permanently blank KPI tile with zero
diagnostic information anywhere (the manager-reported "most of the time
it's blank" bug) -- see the fixes in app/preview_fetch.py's _kpi/_exceltis/
_second_brain/_rolplay_app for the exact prior bug each test guards against.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.models import DashboardConfig, ServiceKind, WidgetConfig, WidgetType
from app.preview_fetch import fetch_widget


def _run(coro):
    return asyncio.run(coro)


class RolplayAppUnsupportedMetricKeyTests(unittest.TestCase):
    """Previously: `metrics.get(w.metric_key, sessions)` silently defaulted
    to total_sessions's value for ANY unrecognized key -- a wrong number
    under the tile's real title, not even a blank."""

    def test_unrecognized_metric_key_errors_instead_of_defaulting_to_total_sessions(self):
        cfg = DashboardConfig(company="Siigo", slug="siigo", title="t",
                              connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 29})
        widget = WidgetConfig(id="w1", type=WidgetType.kpi_tile, title="t", metric_key="bogus_key",
                              source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")
        row = {"sessions": 10, "users": 5, "scored": 8, "avg_score": 70, "passed": 4}
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": [row]}))):
            preview = _run(fetch_widget(cfg, widget))
        self.assertFalse(preview.ok)
        self.assertIsNone(preview.value)
        self.assertIn("bogus_key", preview.error)

    def test_a_recognized_metric_key_still_works(self):
        cfg = DashboardConfig(company="Siigo", slug="siigo", title="t",
                              connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 29})
        widget = WidgetConfig(id="w1", type=WidgetType.kpi_tile, title="t", metric_key="total_sessions",
                              source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")
        row = {"sessions": 10, "users": 5, "scored": 8, "avg_score": 70, "passed": 4}
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": [row]}))):
            preview = _run(fetch_widget(cfg, widget))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 10)


class PharmaKpiUnsupportedMetricKeyTests(unittest.TestCase):
    def test_unrecognized_metric_key_errors(self):
        cfg = DashboardConfig(company="X", slug="x", title="t", connector=ServiceKind.pharma_kpi,
                              connector_handle={"tenant": "x"})
        widget = WidgetConfig(id="w1", type=WidgetType.kpi_tile, title="t", metric_key="bogus_key",
                              source_kind=ServiceKind.pharma_kpi, source_action="kpi.overview")
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"overview": {"total_sessions": 5}}))):
            preview = _run(fetch_widget(cfg, widget))
        self.assertFalse(preview.ok)
        self.assertIn("bogus_key", preview.error)


class ExceltisUnsupportedMetricKeyTests(unittest.TestCase):
    """Previously: a kpi_tile with an unrecognized metric_key fell through
    to the usecase-breakdown branch at the bottom of _exceltis, returning
    `rows=[...]` instead of `value=` -- a wrong-shaped response KpiTile
    can't render at all (it reads .value), so the tile showed blank."""

    def test_kpi_tile_unrecognized_metric_key_errors_not_a_table(self):
        cfg = DashboardConfig(company="Heineken", slug="heineken", title="t",
                              connector=ServiceKind.pharma_exceltis_rest,
                              connector_handle={"exercise_ids": [1]})
        widget = WidgetConfig(id="w1", type=WidgetType.kpi_tile, title="t", metric_key="bogus_key",
                              source_kind=ServiceKind.pharma_exceltis_rest, source_action="/api/rol_play_sim_extractor")
        rows = [{"Calificacion": 90, "Caso_de_Uso_Nombre": "A"}]
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, rows))):
            preview = _run(fetch_widget(cfg, widget))
        self.assertFalse(preview.ok)
        self.assertIsNone(preview.rows)
        self.assertIn("bogus_key", preview.error)


class SecondBrainMetricPreviewTests(unittest.TestCase):
    """Previously: `ok=w.metric_key in m` was true for any of the 4 known
    keys regardless of whether the stat itself was present -- an org with
    no coaching sessions yet got ok=True, value=None, a blank tile marked
    SUCCESSFUL, so the frontend's "no data" caption never showed either."""

    def _cfg(self):
        return DashboardConfig(company="Acme", slug="acme", title="t",
                              connector=ServiceKind.second_brain,
                              connector_handle={"admin_email": "admin@acme.com"})

    def _widget(self, metric_key):
        return WidgetConfig(id="w1", type=WidgetType.kpi_tile, title="t", metric_key=metric_key,
                            source_kind=ServiceKind.second_brain, source_action="organizations/full-profile")

    def test_absent_stat_is_reported_as_no_data_not_a_silent_success(self):
        body = {"stats": {"total_members": 12}}  # total_coaching_sessions absent
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, body))):
            preview = _run(fetch_widget(self._cfg(), self._widget("coaching_sessions")))
        self.assertFalse(preview.ok)
        self.assertIsNone(preview.value)

    def test_present_stat_of_zero_is_still_ok(self):
        body = {"stats": {"total_coaching_sessions": 0}}
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, body))):
            preview = _run(fetch_widget(self._cfg(), self._widget("coaching_sessions")))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 0)

    def test_unrecognized_metric_key_errors(self):
        body = {"stats": {"total_members": 12}}
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, body))):
            preview = _run(fetch_widget(self._cfg(), self._widget("bogus_key")))
        self.assertFalse(preview.ok)
        self.assertIn("bogus_key", preview.error)


if __name__ == "__main__":
    unittest.main()
