"""Regression tests for "Sugerencia de KPI's Cesar.xlsx" -- 19 KPIs the tech
lead specified across 5 perspectives. Every one implemented here was first
verified against REAL live data (Siigo client_id=29, Takeda client_id=13)
before being built:

- Group 1 (activation/weekly-frequency/MAU/practices-to-mastery/delta-score/
  readiness/mastery-distribution) needs only r_user/r_user_session/SCORE_SQL,
  confirmed to work for any rolplay_app_sql tenant.
- Group 2 (commercial-domain breakdown, top strengths/opportunities,
  adoption-movement-rate) depends on raw_closing_data carrying a rich
  per-session evaluation JSON -- confirmed real for Siigo (5 scored
  "bloque_*" blocks, 24 "rubrica_pN_*" checklist items, "intencion_movement")
  and confirmed ABSENT for Takeda (raw_closing_data is NULL for every
  session there). These widgets discover keys dynamically via regex, never
  a hardcoded Siigo field list, and report "no data" (never a fabricated
  value) when a tenant/product's evaluator doesn't produce this shape.

NOT implemented, deliberately (see dashboard_planning.py's _cesar_kpis_page
docstring for the full reasoning): KPI-2.1 (no duration column exists
anywhere in the schema), KPI-3.1/3.3/5.2 (would require classifying
free-text fields into fixed categories -- a fabricated rule, not a real
measurement), KPI-4.4 (would double-count the Score by Commercial Domain
widget's own "Romper el No" data under a different label).
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.dashboard_planning import _cesar_kpis_page, _assemble_pages
from app.models import (
    DashboardConfig, DiscoveredMetric, MetricType, NormalizedSchema,
    ServiceKind, WidgetConfig, WidgetType,
)
from app.preview_fetch import (
    ADOPTION_MOVEMENT_ID, COMMERCIAL_DOMAIN_ID, MASTERY_DISTRIBUTION_ID,
    TOP_OPPORTUNITIES_ID, TOP_STRENGTHS_ID,
    _adoption_movement_rate, _commercial_domain_rows, _mastery_distribution_rows,
    _rubrica_tag_counts, fetch_widget,
)


def _run(coro):
    return asyncio.run(coro)


def _rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Siigo", slug="siigo", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
    ])


def _non_rolplay_schema() -> NormalizedSchema:
    return NormalizedSchema(company="Apotex", slug="apotex", metrics=[
        DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                         source_kind=ServiceKind.pharma_kpi, source_action="kpi.overview"),
    ])


def _cfg(client_id=29, date_range=("2026-06-23", "2026-07-30")):
    return DashboardConfig(
        company="Siigo", slug="siigo", title="Siigo Analytics",
        connector=ServiceKind.rolplay_app_sql,
        connector_handle={"client_id": client_id, "date_range": list(date_range)},
    )


def _widget(id_, type_, metric_key=None):
    return WidgetConfig(id=id_, type=type_, title="t", metric_key=metric_key,
                        source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session")


class CesarKpisPageTests(unittest.TestCase):
    def test_builds_a_kpis_page_for_rolplay_app_sql(self):
        page = _cesar_kpis_page(_rolplay_schema())
        self.assertEqual(page.id, "kpis")
        widget_ids = {w.id for r in page.rows for w in r.widgets}
        self.assertIn("tile_cesar_activation_rate", widget_ids)
        self.assertIn("tile_cesar_readiness_index", widget_ids)
        self.assertIn(MASTERY_DISTRIBUTION_ID, widget_ids)
        self.assertIn(ADOPTION_MOVEMENT_ID, widget_ids)
        self.assertIn(COMMERCIAL_DOMAIN_ID, widget_ids)
        self.assertIn(TOP_STRENGTHS_ID, widget_ids)
        self.assertIn(TOP_OPPORTUNITIES_ID, widget_ids)

    def test_none_for_non_rolplay_app_sql_connectors(self):
        self.assertIsNone(_cesar_kpis_page(_non_rolplay_schema()))

    def test_appears_in_assemble_pages_before_reports(self):
        pages = _assemble_pages(_rolplay_schema(), {}, [])
        ids = [p.id for p in pages]
        self.assertIn("kpis", ids)
        self.assertLess(ids.index("kpis"), ids.index("reports"))

    def test_no_duplicate_widget_ids_within_the_page(self):
        page = _cesar_kpis_page(_rolplay_schema())
        ids = [w.id for r in page.rows for w in r.widgets]
        self.assertEqual(len(ids), len(set(ids)), ids)


class MasteryDistributionTests(unittest.TestCase):
    def test_buckets_match_cesar_spec_exactly(self):
        rows = _mastery_distribution_rows([50, 74, 75, 90, 94, 95, 100])
        by_label = {r["label"]: r["value"] for r in rows}
        self.assertEqual(by_label["Basic (<75)"], 2)      # 50, 74
        self.assertEqual(by_label["Intermediate (75-94)"], 3)  # 75, 90, 94
        self.assertEqual(by_label["Advanced (>=95)"], 2)  # 95, 100

    def test_empty_for_no_scores(self):
        self.assertEqual(_mastery_distribution_rows([]), [])


class CommercialDomainTests(unittest.TestCase):
    def test_discovers_whatever_bloque_keys_exist_dynamically(self):
        parsed = [
            {"bloque_crear_conexion_score": "60", "bloque_obtener_si_score": "80"},
            {"bloque_crear_conexion_score": "70", "bloque_obtener_si_score": "90"},
        ]
        rows = _commercial_domain_rows(parsed)
        by_domain = {r["domain"]: r["avg_score"] for r in rows}
        self.assertEqual(by_domain["Crear Conexion"], 65.0)
        self.assertEqual(by_domain["Obtener Si"], 85.0)

    def test_ignores_non_numeric_or_missing_scores(self):
        parsed = [{"bloque_x_score": "N/A"}, {"bloque_x_score": "50"}]
        rows = _commercial_domain_rows(parsed)
        self.assertEqual(rows[0]["sessions"], 1)  # only the valid one counted

    def test_empty_for_sessions_with_no_bloque_keys_at_all(self):
        # Matches Takeda: raw_closing_data has no bloque_* structure.
        self.assertEqual(_commercial_domain_rows([{"overall_score": "80"}]), [])

    def test_sorted_descending_by_avg_score(self):
        parsed = [{"bloque_a_score": "40", "bloque_b_score": "90"}]
        rows = _commercial_domain_rows(parsed)
        self.assertEqual([r["domain"] for r in rows], ["B", "A"])


class RubricaTagCountsTests(unittest.TestCase):
    def test_counts_passed_items_for_top_strengths(self):
        parsed = [
            {"rubrica_p1_nombre": "Saluda cordialmente", "rubrica_p1_cumplido": "true"},
            {"rubrica_p1_nombre": "Saluda cordialmente", "rubrica_p1_cumplido": "true"},
            {"rubrica_p1_nombre": "Saluda cordialmente", "rubrica_p1_cumplido": "false"},
        ]
        strengths = _rubrica_tag_counts(parsed, want_pass=True)
        self.assertEqual(strengths, [{"item": "Saluda cordialmente", "count": 2}])

    def test_counts_failed_items_for_top_opportunities(self):
        parsed = [
            {"rubrica_p1_nombre": "Cierra la venta", "rubrica_p1_cumplido": "false"},
            {"rubrica_p1_nombre": "Cierra la venta", "rubrica_p1_cumplido": "false"},
        ]
        opportunities = _rubrica_tag_counts(parsed, want_pass=False)
        self.assertEqual(opportunities, [{"item": "Cierra la venta", "count": 2}])

    def test_ignores_na_cumplido_values(self):
        parsed = [{"rubrica_p1_nombre": "Item", "rubrica_p1_cumplido": "N/A"}]
        self.assertEqual(_rubrica_tag_counts(parsed, want_pass=True), [])

    def test_discovers_any_number_of_rubrica_items_not_hardcoded_to_24(self):
        parsed = [{f"rubrica_p{i}_nombre": f"Item {i}", f"rubrica_p{i}_cumplido": "true"} for i in range(1, 31)]
        result = _rubrica_tag_counts(parsed, want_pass=True)
        self.assertEqual(len(result), 10)  # capped at top 10, but all 30 were discovered/counted

    def test_empty_for_sessions_with_no_rubrica_items(self):
        self.assertEqual(_rubrica_tag_counts([{"overall_score": "80"}], want_pass=True), [])


class AdoptionMovementRateTests(unittest.TestCase):
    def test_computes_pct_of_positive_movements(self):
        parsed = [{"intencion_movement": "Subió"}, {"intencion_movement": "Subió"}, {"intencion_movement": "Bajó"}]
        self.assertEqual(_adoption_movement_rate(parsed), 66.7)

    def test_none_when_no_sessions_carry_the_field(self):
        # Matches Takeda: no raw_closing_data at all -- must be None, not a
        # fabricated 0%, so the widget reports "no data" honestly.
        self.assertIsNone(_adoption_movement_rate([{"overall_score": "80"}]))

    def test_none_for_empty_input(self):
        self.assertIsNone(_adoption_movement_rate([]))


class FetchWidgetIntegrationTests(unittest.TestCase):
    """End-to-end through fetch_widget's dispatch, with post_json mocked --
    proves the id-based routing actually wires up, not just the pure
    functions in isolation."""

    def test_commercial_domain_widget_routes_and_parses_real_shaped_json(self):
        import json as _json
        session_json = _json.dumps({"bloque_crear_conexion_score": "60", "bloque_obtener_si_score": "80"})

        async def fake_sql(_url, _payload):
            return 200, {"data": [{"d": session_json}]}

        widget = _widget(COMMERCIAL_DOMAIN_ID, WidgetType.table)
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), widget))
        self.assertTrue(pv.ok)
        self.assertEqual(len(pv.rows), 2)

    def test_commercial_domain_widget_reports_no_data_not_a_crash_when_empty(self):
        async def fake_sql(_url, _payload):
            return 200, {"data": []}

        widget = _widget(COMMERCIAL_DOMAIN_ID, WidgetType.table)
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), widget))
        self.assertFalse(pv.ok)
        self.assertIsNotNone(pv.error)

    def test_adoption_movement_tile_routes_by_id(self):
        import json as _json
        session_json = _json.dumps({"intencion_movement": "Subió"})

        async def fake_sql(_url, _payload):
            return 200, {"data": [{"d": session_json}]}

        widget = _widget(ADOPTION_MOVEMENT_ID, WidgetType.kpi_tile)
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), widget))
        self.assertTrue(pv.ok)
        self.assertEqual(pv.value, 100.0)

    def test_group1_kpi_tile_routes_by_metric_key(self):
        call_count = {"n": 0}

        async def fake_sql(_url, payload):
            call_count["n"] += 1
            sql = payload["sql"]
            if "YEARWEEK" in sql:
                return 200, {"data": [{"n": 10, "sessions": 40, "weeks": 4}]}
            if "DATE_SUB" in sql:
                return 200, {"data": [{"n": 5}]}
            if "ORDER BY s.user_id" in sql:
                return 200, {"data": []}
            return 200, {"data": [{"n": 20}]}  # enrolled count

        widget = _widget("tile_cesar_activation_rate", WidgetType.kpi_tile, "activation_rate")
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), widget))
        self.assertTrue(pv.ok)
        self.assertEqual(pv.value, 50.0)  # 10 active / 20 enrolled * 100



class ReadinessIndexSamplingBiasTests(unittest.TestCase):
    """Regression: mastered_users used to come from the SAME LIMIT-500,
    ORDER BY user_id scan as delta_score, so readiness_index (mastered_users /
    enrolled) divided a capped, systematically-biased numerator (always the
    lowest-numbered user_ids) by an UNCAPPED enrolled denominator -- silently
    trending toward 0% as a tenant grew past 500 scored sessions. This mirrors
    a fix already shipped on the TS side (lib/bridge-rolplay-app.ts's
    rolplayAppCesarGroup1) that this test file had no equivalent coverage for.
    """

    def test_mastered_users_counted_over_the_whole_range_not_just_the_delta_scan(self):
        # A large tenant: 1000 enrolled, but only the mastery AGGREGATE query
        # (no ORDER BY, no LIMIT) reports the true count of 250 mastered users.
        # The bounded delta-score scan (ORDER BY s.user_id ... LIMIT 500) would
        # only ever see a handful of them if it were (wrongly) used for this.
        async def fake_sql(_url, payload):
            sql = payload["sql"]
            if "YEARWEEK" in sql:
                return 200, {"data": [{"n": 800, "sessions": 4000, "weeks": 4}]}
            if "DATE_SUB" in sql:
                return 200, {"data": [{"n": 600}]}
            if "mastered_users" in sql:
                # The DEDICATED unbounded aggregate -- must be trusted.
                return 200, {"data": [{"mastered_users": 250}]}
            if "ORDER BY s.user_id" in sql:
                # The bounded delta-score scan -- sees only 2 rows, 1 user.
                return 200, {"data": [
                    {"user_id": 1, "date_created": "2026-06-24", "sc": 40},
                    {"user_id": 1, "date_created": "2026-06-25", "sc": 96},
                ]}
            return 200, {"data": [{"n": 1000}]}  # enrolled count

        widget = _widget("tile_cesar_readiness_index", WidgetType.kpi_tile, "readiness_index")
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), widget))

        self.assertTrue(pv.ok)
        # 250/1000, from the aggregate -- NOT 1/1000 from the truncated scan.
        self.assertEqual(pv.value, 25.0)

    def test_delta_score_still_computed_from_the_bounded_scan(self):
        async def fake_sql(_url, payload):
            sql = payload["sql"]
            if "YEARWEEK" in sql:
                return 200, {"data": [{"n": 5, "sessions": 20, "weeks": 2}]}
            if "DATE_SUB" in sql:
                return 200, {"data": [{"n": 2}]}
            if "mastered_users" in sql:
                return 200, {"data": [{"mastered_users": 1}]}
            if "ORDER BY s.user_id" in sql:
                return 200, {"data": [
                    {"user_id": 1, "date_created": "2026-06-24", "sc": 40},
                    {"user_id": 1, "date_created": "2026-06-25", "sc": 60},
                    {"user_id": 1, "date_created": "2026-06-26", "sc": 96},
                    {"user_id": 2, "date_created": "2026-06-24", "sc": 80},
                ]}
            return 200, {"data": [{"n": 10}]}

        widget = _widget("tile_cesar_delta_score", WidgetType.kpi_tile, "delta_score")
        with patch("app.preview_fetch.post_json", new=AsyncMock(side_effect=fake_sql)):
            pv = _run(fetch_widget(_cfg(), widget))

        self.assertTrue(pv.ok)
        self.assertEqual(pv.value, 56)  # only user 1 has >=2 sessions: 96-40


if __name__ == "__main__":
    unittest.main()
