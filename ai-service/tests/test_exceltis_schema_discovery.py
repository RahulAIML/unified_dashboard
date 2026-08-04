"""Regression tests for _exceltis_schema's missing dimension/timeseries
metrics -- found live on Heineken: real rows carry a usecase id
(ID_Caso_de_Uso), a real timestamp (Fecha_y_Hora), and a real per-user name
(Usuario_Nombre), but schema_discovery never declared a dimension or
timeseries metric for this connector, so dashboard_planning.py's heuristic
never built anything beyond 3 KPI tiles for ANY pharma_exceltis_rest tenant.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.schema_discovery import _exceltis_schema
from app.models import CompanyKnowledge, MetricType, NormalizedSchema, ServiceDescriptor, ServiceKind


def _run(coro):
    return asyncio.run(coro)


async def _noop_log(*_args):
    return None


def _svc() -> ServiceDescriptor:
    return ServiceDescriptor(kind=ServiceKind.pharma_exceltis_rest, name="heineken exceltis REST",
                             base_url="https://serv.aux-rolplay.com/heineken", alive=True, has_data=True)


class ExceltisSchemaDiscoveryTests(unittest.TestCase):
    def _run_discovery(self, rows: list[dict]) -> NormalizedSchema:
        schema = NormalizedSchema(company="Heineken", slug="heineken")
        k = CompanyKnowledge(company="Heineken", slug="heineken", exercise_ids=[137])
        with patch("app.agents.schema_discovery.get_json", new=AsyncMock(return_value=(200, rows))):
            _run(_exceltis_schema(k, _svc(), schema, [137], _noop_log))
        return schema

    def test_declares_a_dimension_metric_for_usecase_breakdown(self):
        schema = self._run_discovery([{"Calificacion": 90, "ID_Caso_de_Uso": 137}])
        dims = [m for m in schema.metrics if m.type == MetricType.dimension]
        self.assertEqual(len(dims), 1)
        self.assertEqual(dims[0].key, "sessions_by_usecase")

    def test_declares_a_timeseries_metric_when_scores_are_numeric(self):
        schema = self._run_discovery([{"Calificacion": 90, "Fecha_y_Hora": "2026-01-01"}])
        ts = [m for m in schema.metrics if m.type == MetricType.timeseries]
        self.assertEqual(len(ts), 1)
        self.assertEqual(ts[0].key, "score_trend")

    def test_no_timeseries_metric_for_counts_only_clients(self):
        # "No aplica" (qualitative, non-numeric) results -- has_numeric_score
        # stays False, so a score trend would have nothing real to show.
        schema = self._run_discovery([{"Calificacion": "No aplica"}])
        ts = [m for m in schema.metrics if m.type == MetricType.timeseries]
        self.assertEqual(ts, [])
        # The dimension metric (session counts, no score needed) still exists.
        dims = [m for m in schema.metrics if m.type == MetricType.dimension]
        self.assertEqual(len(dims), 1)

    def test_no_exercise_ids_still_produces_the_dimension_metric(self):
        schema = NormalizedSchema(company="Heineken", slug="heineken")
        k = CompanyKnowledge(company="Heineken", slug="heineken", exercise_ids=[])
        _run(_exceltis_schema(k, _svc(), schema, [], _noop_log))
        dims = [m for m in schema.metrics if m.type == MetricType.dimension]
        self.assertEqual(len(dims), 1)


if __name__ == "__main__":
    unittest.main()
