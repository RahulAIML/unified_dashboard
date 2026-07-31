"""Regression/coverage tests for the Solution Journey widget.

The hand-built /journey page (app/journey/page.tsx + lib/journey.ts) shows
the tenant's real services in a fixed progression — LMS -> Master Coach ->
Practice Simulator -> Certification -> Second Brain, filtered to whichever
subset the tenant actually has, never reordered or padded. The AI-generated
dashboard had no equivalent at all. This adds a `journey` widget type,
generated deterministically (never LLM-proposed) only when the connector's
discovered modules are evidence-backed enough to place in that exact 5-module
ontology — rolplay_app_sql's schema_discovery already maps r_simulator.category
through CATEGORY_TO_MODULE before this ever runs, so its modules ARE that
ontology. pharma_kpi (raw activity_type strings) and coach_app_sql (no module
discovery at all) never get one — forcing an unverified guess into this
specific 5-name ontology would be worse than omitting it.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app import journey as journey_lib
from app.agents import validation
from app.agents.dashboard_planning import _auto_journey_widget
from app.models import (
    DashboardConfig,
    DashboardRow,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceDescriptor,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)
from app.preview_fetch import fetch_widget


def _run(coro):
    return asyncio.run(coro)


class JourneyLibTests(unittest.TestCase):
    def test_orders_a_subset_in_canonical_sequence_regardless_of_input_order(self):
        # Real shape: certification and simulator present, coach absent —
        # must still come out in LMS/Coach/Simulator/Certification/SB order.
        self.assertEqual(
            journey_lib.ordered_stages(["certification", "simulator"]),
            ["simulator", "certification"],
        )

    def test_is_canonical_false_for_any_unrecognized_module(self):
        # One raw, unclassified string (pharma_kpi-style) disqualifies the
        # whole set — this must never partially match.
        self.assertFalse(journey_lib.is_canonical(["coach", "Coach evaluador"]))

    def test_has_journey_requires_at_least_two_canonical_stages(self):
        self.assertFalse(journey_lib.has_journey(["simulator"]))
        self.assertTrue(journey_lib.has_journey(["simulator", "certification"]))

    def test_has_journey_false_for_non_canonical_modules_even_if_two_or_more(self):
        self.assertFalse(journey_lib.has_journey(["Coach evaluador", "Coach maestro"]))


class AutoJourneyWidgetTests(unittest.TestCase):
    def _schema(self, modules) -> NormalizedSchema:
        return NormalizedSchema(
            company="X", slug="x", modules=modules,
            metrics=[DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                                     source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")],
        )

    def test_creates_a_journey_widget_for_canonical_modules(self):
        widgets = _auto_journey_widget(self._schema(["simulator", "certification"]), set())
        self.assertEqual(len(widgets), 1)
        self.assertEqual(widgets[0].id, "journey")
        self.assertEqual(widgets[0].type, WidgetType.journey)

    def test_skips_for_a_single_module(self):
        self.assertEqual(_auto_journey_widget(self._schema(["simulator"]), set()), [])

    def test_skips_for_non_canonical_raw_module_strings(self):
        # pharma_kpi's real shape: activity_type values, not the 5-name ontology.
        schema = self._schema(["Coach evaluador", "Coach maestro", "Visita Médica APECS"])
        self.assertEqual(_auto_journey_widget(schema, set()), [])

    def test_does_not_duplicate_an_existing_journey_id(self):
        self.assertEqual(
            _auto_journey_widget(self._schema(["simulator", "certification"]), {"journey"}),
            [],
        )


class RolplayAppJourneyPreviewTests(unittest.TestCase):
    def _cfg(self) -> DashboardConfig:
        return DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics",
            connector=ServiceKind.rolplay_app_sql, connector_handle={"client_id": 29},
        )

    def _widget(self) -> WidgetConfig:
        return WidgetConfig(id="journey", type=WidgetType.journey, title="Solution Journey",
                            source_kind=ServiceKind.rolplay_app_sql, source_action="journey")

    def test_orders_stages_canonically_and_carries_real_counts(self):
        # DB GROUP BY order deliberately scrambled vs. journey order.
        rows = [
            {"category": "SEGMENT", "total_sessions": 3, "passed_sessions": 2, "pass_rate": 66.7},
            {"category": "SIM", "total_sessions": 144, "passed_sessions": 53, "pass_rate": 36.8},
        ]
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget()))
        self.assertTrue(preview.ok)
        modules = [r["module"] for r in preview.rows]
        self.assertEqual(modules, ["simulator", "certification"])
        sim_row = preview.rows[0]
        self.assertEqual(sim_row["total_sessions"], 144)
        self.assertEqual(sim_row["passed_sessions"], 53)
        self.assertEqual(sim_row["phase"], "practice")

    def test_excludes_second_brain_category(self):
        rows = [
            {"category": "SIM", "total_sessions": 10, "passed_sessions": 5, "pass_rate": 50.0},
            {"category": "SB", "total_sessions": 20, "passed_sessions": 20, "pass_rate": 100.0},
        ]
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget()))
        # Only 1 real module (SIM) -- SB excluded means this correctly reports
        # "not enough for a journey", not a 2-stage journey with SB smuggled in.
        self.assertFalse(preview.ok)
        self.assertEqual([r["module"] for r in preview.rows], ["simulator"])

    def test_not_ok_with_fewer_than_two_real_modules(self):
        rows = [{"category": "SIM", "total_sessions": 10, "passed_sessions": 5, "pass_rate": 50.0}]
        with patch("app.preview_fetch.post_json", new=AsyncMock(return_value=(200, {"data": rows}))):
            preview = _run(fetch_widget(self._cfg(), self._widget()))
        self.assertFalse(preview.ok)


class OtherConnectorsRejectJourneyTests(unittest.TestCase):
    def test_pharma_kpi_explicitly_rejects_journey_rather_than_returning_wrong_shape(self):
        cfg = DashboardConfig(
            company="Apotex", slug="apotex", title="Apotex Analytics", connector=ServiceKind.pharma_kpi,
            connector_handle={"tenant": "apotex", "base_url": "https://bridge.test/apotex/bridge/"},
        )
        w = WidgetConfig(id="journey", type=WidgetType.journey, title="t",
                         source_kind=ServiceKind.pharma_kpi, source_action="journey")
        preview = _run(fetch_widget(cfg, w))
        self.assertFalse(preview.ok)
        self.assertIn("journey", preview.error or "")


class JourneyWidgetPassesValidationTests(unittest.TestCase):
    """Same failure class as the approval-donut bug: confirm the journey
    widget's own field choices never trip validation.py's missing_metric
    check (it sets neither metric_key nor an unregistered dimension)."""

    def test_journey_widget_never_trips_missing_metric(self):
        schema = NormalizedSchema(
            company="Siigo", slug="siigo", modules=["simulator", "certification"],
            metrics=[DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                                      source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")],
        )
        widgets = _auto_journey_widget(schema, set())
        cfg = DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics", connector=ServiceKind.rolplay_app_sql,
            rows=[DashboardRow(id="row_charts", title="Analytics", widgets=widgets)],
        )
        service = ServiceDescriptor(kind=ServiceKind.rolplay_app_sql, name="Siigo", base_url="x", has_data=True)

        async def _noop_log(*_args):
            return None

        report = _run(validation.run(cfg, schema, service, _noop_log))
        self.assertTrue(report.ok, f"expected 0 errors, got: {report.issues}")


if __name__ == "__main__":
    unittest.main()
