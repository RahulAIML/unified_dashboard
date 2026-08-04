"""Regression test for pharma_exceltis_rest's preview fetcher (_exceltis /
_exceltis_rows) — had ZERO direct unit test coverage before this, which is
exactly how a real bug introduced while wiring secondary-connector date
ranges (_date_range(cfg, w)) went uncaught until live-testing: _exceltis_rows
called _date_range(cfg, w) without w in its own parameter list, so ANY
exceltis_rest widget with real exercise_ids configured would raise
`NameError: name 'w' is not defined` on every single preview fetch.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.models import DashboardConfig, ServiceKind, WidgetConfig, WidgetType
from app.preview_fetch import fetch_widget


def _run(coro):
    return asyncio.run(coro)


def _cfg(ids=(137, 159, 173)) -> DashboardConfig:
    return DashboardConfig(
        company="Heineken", slug="heineken", title="Heineken Analytics",
        connector=ServiceKind.pharma_exceltis_rest,
        connector_handle={"exercise_ids": list(ids)},
    )


def _widget(type_: WidgetType, metric_key: str | None = None) -> WidgetConfig:
    return WidgetConfig(id=f"w-{metric_key or type_.value}", type=type_, title="t",
                        metric_key=metric_key, source_kind=ServiceKind.pharma_exceltis_rest,
                        source_action="/api/rol_play_sim_extractor")


class ExceltisPreviewTests(unittest.TestCase):
    def test_kpi_tile_total_sessions_does_not_raise(self):
        rows = [{"Calificacion": 90}, {"Calificacion": 60}]
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, rows))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "total_sessions")))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 2)

    def test_kpi_tile_avg_score(self):
        rows = [{"Calificacion": 90}, {"Calificacion": 70}]
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, rows))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.kpi_tile, "avg_score")))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 80.0)

    def test_no_exercise_ids_reports_no_data_not_an_error(self):
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, []))):
            preview = _run(fetch_widget(_cfg(ids=[]), _widget(WidgetType.kpi_tile, "total_sessions")))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.value, 0)

    def test_table_breakdown_by_usecase(self):
        rows = [
            {"Calificacion": 90, "Caso_de_Uso_Nombre": "Objection A"},
            {"Calificacion": 60, "Caso_de_Uso_Nombre": "Objection A"},
            {"Calificacion": 70, "Caso_de_Uso_Nombre": "Objection B"},
        ]
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, rows))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.table)))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.rows[0]["usecase"], "Objection A")
        self.assertEqual(preview.rows[0]["total_sessions"], 2)


class ExceltisTrendAndLeaderboardTests(unittest.TestCase):
    """Regression tests for the gap found live on Heineken: schema_discovery
    never declared a dimension/timeseries metric for this connector, so
    dashboard_planning.py's heuristic never built anything beyond 3 KPI
    tiles -- no trend, no breakdown widget with a real chart, no leaderboard
    -- despite the raw rows already carrying a real timestamp
    (Fecha_y_Hora) and a real per-user name (Usuario_Nombre)."""

    def test_line_chart_builds_a_real_monthly_score_trend(self):
        rows = [
            {"Calificacion": 90, "Fecha_y_Hora": "2026-01-15T10:00:00"},
            {"Calificacion": 70, "Fecha_y_Hora": "2026-01-20T10:00:00"},
            {"Calificacion": 60, "Fecha_y_Hora": "2026-02-05T10:00:00"},
        ]
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, rows))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.line_chart)))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.series, [
            {"date": "2026-01", "value": 80.0, "sessions": 2},
            {"date": "2026-02", "value": 60.0, "sessions": 1},
        ])

    def test_line_chart_reports_no_data_rather_than_crashing_on_empty_rows(self):
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, []))):
            preview = _run(fetch_widget(_cfg(), _widget(WidgetType.line_chart)))
        self.assertFalse(preview.ok)
        self.assertEqual(preview.series, [])

    def test_best_performers_ranks_by_real_usuario_nombre(self):
        from app.preview_fetch import BEST_PERFORMERS_ID
        rows = [
            {"Calificacion": 90, "Usuario_Nombre": "Diana"},
            {"Calificacion": 70, "Usuario_Nombre": "Diana"},
            {"Calificacion": 95, "Usuario_Nombre": "Carlos"},
        ]
        widget = WidgetConfig(id=BEST_PERFORMERS_ID, type=WidgetType.table, title="Best Performers",
                              source_kind=ServiceKind.pharma_exceltis_rest, source_action="/api/rol_play_sim_extractor")
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, rows))):
            preview = _run(fetch_widget(_cfg(), widget))
        self.assertTrue(preview.ok)
        self.assertEqual(preview.rows[0]["user_name"], "Carlos")  # 95 > 80 avg
        self.assertEqual(preview.rows[0]["avg_score"], 95.0)
        self.assertEqual(preview.rows[1]["user_name"], "Diana")
        self.assertEqual(preview.rows[1]["sessions"], 2)
        self.assertEqual(preview.rows[1]["avg_score"], 80.0)

    def test_best_performers_skips_rows_with_no_name_or_score(self):
        from app.preview_fetch import BEST_PERFORMERS_ID
        rows = [
            {"Calificacion": 90, "Usuario_Nombre": ""},
            {"Calificacion": None, "Usuario_Nombre": "Diana"},
        ]
        widget = WidgetConfig(id=BEST_PERFORMERS_ID, type=WidgetType.table, title="Best Performers",
                              source_kind=ServiceKind.pharma_exceltis_rest, source_action="/api/rol_play_sim_extractor")
        with patch("app.preview_fetch.get_json", new=AsyncMock(return_value=(200, rows))):
            preview = _run(fetch_widget(_cfg(), widget))
        self.assertFalse(preview.ok)
        self.assertEqual(preview.rows, [])


if __name__ == "__main__":
    unittest.main()
