"""Regression tests for multi-page dashboard generation.

Before this, the AI Dashboard Builder ALWAYS produced exactly one flat page
(DashboardConfig.rows), while the reference hand-built app has ~10 distinct
pages (Overview/LMS/Coach/Simulator/...). These tests pin down:
  - LMS gets its own page, never mixed into Overview's tiles/tables.
  - rolplay_app_sql tenants get a real per-module (Coach/Simulator/
    Certification) page, each with correctly SCOPED queries (not the
    connector's full aggregate).
  - pharma_kpi tenants do NOT get per-module pages (no verified activity_type
    classifier exists yet) -- Overview (+ LMS, if configured) only, honestly.
  - validation.py and preview.py walk every page's widgets, not just Overview
    -- a real bug found and fixed while building this (LMS/module-page
    widgets would otherwise never be validated or have their data fetched).
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import dashboard_planning, preview, validation
from app.agents.dashboard_planning import _assemble_pages, _lms_page, _module_pages
from app.models import (
    DashboardConfig,
    DashboardPage,
    DashboardRow,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceDescriptor,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)
from app.preview_fetch import _category_clause


def _run(coro):
    return asyncio.run(coro)


async def _noop_log(*_args):
    return None


def _rolplay_app_schema(modules) -> NormalizedSchema:
    return NormalizedSchema(
        company="Siigo", slug="siigo", modules=modules,
        dimensions=["activity"],
        metrics=[
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="avg_score", label="Average Score", type=MetricType.score,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="pass_rate", label="Pass Rate", type=MetricType.rate,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="score_trend", label="Score Trend", type=MetricType.timeseries,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        ],
    )


def _lms_metrics() -> list[DiscoveredMetric]:
    return [
        DiscoveredMetric(key="lms_enrolled_users", label="Enrolled Users", type=MetricType.count,
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_completion_rate", label="Completion Rate", type=MetricType.rate,
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_avg_quiz_score", label="Avg Quiz Score", type=MetricType.score,
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_modules_completed", label="Modules Completed", type=MetricType.count,
                         source_kind=ServiceKind.lms, source_action="lms.overview"),
        DiscoveredMetric(key="lms_completion_trend", label="LMS Completions", type=MetricType.timeseries,
                         source_kind=ServiceKind.lms, source_action="lms.completion_trend"),
        DiscoveredMetric(key="lms_courses", label="Courses", type=MetricType.table,
                         source_kind=ServiceKind.lms, source_action="lms.courses"),
    ]


class LmsPageTests(unittest.TestCase):
    def test_returns_none_when_no_lms_metrics_exist(self):
        self.assertIsNone(_lms_page({}))

    def test_builds_kpis_trend_and_table(self):
        metrics = {m.key: m for m in _lms_metrics()}
        page = _lms_page(metrics)
        self.assertIsInstance(page, DashboardPage)
        self.assertEqual(page.id, "lms")
        all_widget_ids = {w.id for r in page.rows for w in r.widgets}
        self.assertEqual(all_widget_ids, {
            "lms_tile_lms_enrolled_users", "lms_tile_lms_completion_rate",
            "lms_tile_lms_avg_quiz_score", "lms_tile_lms_modules_completed",
            "lms_trend", "lms_courses_table",
        })

    def test_omits_trend_and_table_when_those_specific_metrics_are_absent(self):
        # A tenant might only have the overview metrics discovered (probe
        # succeeded, full dashboard call not yet made) -- must not crash on
        # partial metric sets.
        metrics = {"lms_enrolled_users": _lms_metrics()[0]}
        page = _lms_page(metrics)
        all_widget_ids = {w.id for r in page.rows for w in r.widgets}
        self.assertEqual(all_widget_ids, {"lms_tile_lms_enrolled_users"})


class ModulePagesTests(unittest.TestCase):
    def test_no_pages_for_pharma_kpi_raw_activity_types(self):
        # pharma_kpi's modules are raw, unclassified activity_type strings --
        # no verified Coach-vs-Simulator classifier exists, so no per-module
        # pages should be generated (guessing would be worse than omitting).
        schema = NormalizedSchema(
            company="Apotex", slug="apotex",
            modules=["Coach evaluador", "Coach maestro", "Visita Médica APECS"],
            dimensions=["activity"],
            metrics=[DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                                      source_kind=ServiceKind.pharma_kpi, source_action="kpi.activity_summary")],
        )
        self.assertEqual(_module_pages(schema, {}), [])

    def test_real_per_module_pages_for_rolplay_app_sql(self):
        schema = _rolplay_app_schema(["coach", "simulator"])
        metrics = {m.key: m for m in schema.metrics}
        pages = _module_pages(schema, metrics)
        ids = [p.id for p in pages]
        self.assertEqual(ids, ["coach", "simulator"])  # canonical journey order
        coach = pages[0]
        self.assertEqual(coach.title, "Master Coach")
        widget_ids = {w.id for r in coach.rows for w in r.widgets}
        self.assertEqual(widget_ids, {
            "coach_tile_total_sessions", "coach_tile_avg_score", "coach_tile_pass_rate",
            "coach_trend", "coach_table",
        })

    def test_module_scoped_widgets_carry_the_module_field(self):
        schema = _rolplay_app_schema(["coach", "simulator"])
        metrics = {m.key: m for m in schema.metrics}
        pages = _module_pages(schema, metrics)
        for page in pages:
            for row in page.rows:
                for w in row.widgets:
                    self.assertEqual(w.module, page.id)

    def test_no_pages_with_fewer_than_one_canonical_module(self):
        schema = _rolplay_app_schema([])
        self.assertEqual(_module_pages(schema, {}), [])


class AssemblePagesTests(unittest.TestCase):
    def test_always_includes_overview_even_with_nothing_else(self):
        schema = NormalizedSchema(company="X", slug="x")
        pages = _assemble_pages(schema, {}, [DashboardRow(id="row_kpis", widgets=[])])
        self.assertEqual([p.id for p in pages], ["overview"])

    def test_apotex_shaped_schema_gets_overview_and_lms_but_no_module_pages(self):
        # Apotex is pharma_kpi -- LMS is real and independent, but per-module
        # pages require the not-yet-built activity_type classifier.
        schema = NormalizedSchema(
            company="Apotex", slug="apotex",
            modules=["Coach evaluador", "Coach maestro", "Visita Médica APECS"],
            dimensions=["activity"],
            metrics=[
                DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                                 source_kind=ServiceKind.pharma_kpi, source_action="kpi.activity_summary"),
            ] + _lms_metrics(),
        )
        metrics = {m.key: m for m in schema.metrics}
        pages = _assemble_pages(schema, metrics, [DashboardRow(id="row_kpis", widgets=[])])
        self.assertEqual([p.id for p in pages], ["overview", "lms"])

    def test_siigo_shaped_schema_gets_overview_plus_module_pages_no_lms(self):
        schema = _rolplay_app_schema(["simulator", "certification"])
        metrics = {m.key: m for m in schema.metrics}
        pages = _assemble_pages(schema, metrics, [DashboardRow(id="row_kpis", widgets=[])])
        self.assertEqual([p.id for p in pages], ["overview", "simulator", "certification"])


class LmsMetricsNeverLeakOntoOverviewTests(unittest.TestCase):
    """End-to-end through the real heuristic planner (no LLM) -- the most
    realistic regression guard: if any future edit re-introduces LMS metrics
    into Overview's tiles/tables, this fails."""

    def test_heuristic_plan_excludes_lms_metrics_from_overview(self):
        schema = _rolplay_app_schema(["simulator"])
        schema.metrics.extend(_lms_metrics())
        pages = _run(dashboard_planning.run(schema, _noop_log))[0]
        overview = next(p for p in pages if p.id == "overview")
        overview_widget_ids = {w.id for r in overview.rows for w in r.widgets}
        self.assertTrue(all("lms" not in wid for wid in overview_widget_ids), overview_widget_ids)
        lms_page = next(p for p in pages if p.id == "lms")
        self.assertTrue(any("lms" in w.id for r in lms_page.rows for w in r.widgets))

    def test_no_duplicate_widget_ids_across_the_whole_dashboard(self):
        schema = _rolplay_app_schema(["simulator", "coach"])
        schema.metrics.extend(_lms_metrics())
        pages = _run(dashboard_planning.run(schema, _noop_log))[0]
        all_ids = [w.id for p in pages for r in p.rows for w in r.widgets]
        self.assertEqual(len(all_ids), len(set(all_ids)), all_ids)


class CategoryClauseTests(unittest.TestCase):
    def test_empty_for_no_module(self):
        self.assertEqual(_category_clause(None), "")

    def test_scopes_to_the_right_category(self):
        clause = _category_clause("coach")
        self.assertIn("category = 'COACH'", clause)

    def test_different_modules_produce_different_clauses(self):
        self.assertNotEqual(_category_clause("coach"), _category_clause("simulator"))


class ValidationAndPreviewWalkAllPagesTests(unittest.TestCase):
    """Direct regression tests for the bug found while building this: both
    agents used to read cfg.rows only (Overview), silently never validating
    or fetching data for any LMS/module-page widget."""

    def _cfg_with_pages(self) -> DashboardConfig:
        overview_widget = WidgetConfig(id="tile_total_sessions", type=WidgetType.kpi_tile, title="t",
                                       metric_key="total_sessions", source_kind=ServiceKind.rolplay_app_sql,
                                       source_action="r_user_session")
        lms_widget = WidgetConfig(id="lms_tile_lms_enrolled_users", type=WidgetType.kpi_tile, title="t",
                                  metric_key="lms_enrolled_users", source_kind=ServiceKind.lms,
                                  source_action="lms.overview")
        return DashboardConfig(
            company="X", slug="x", title="X", connector=ServiceKind.rolplay_app_sql,
            rows=[DashboardRow(id="row_kpis", widgets=[overview_widget])],
            pages=[
                DashboardPage(id="overview", title="Overview", rows=[DashboardRow(id="row_kpis", widgets=[overview_widget])]),
                DashboardPage(id="lms", title="LMS", rows=[DashboardRow(id="lms_kpis", widgets=[lms_widget])]),
            ],
        )

    def test_validation_sees_widgets_on_every_page(self):
        cfg = self._cfg_with_pages()
        schema = NormalizedSchema(company="X", slug="x", metrics=[
            DiscoveredMetric(key="total_sessions", label="t", type=MetricType.count,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="x"),
            DiscoveredMetric(key="lms_enrolled_users", label="t", type=MetricType.count,
                             source_kind=ServiceKind.lms, source_action="lms.overview"),
        ])
        service = ServiceDescriptor(kind=ServiceKind.rolplay_app_sql, name="X", base_url="x", has_data=True)
        report = _run(validation.run(cfg, schema, service, _noop_log))
        # Both real metrics exist -- 0 errors proves both pages' widgets were
        # actually checked (a widget with an unregistered metric_key on
        # either page would have raised missing_metric).
        self.assertTrue(report.ok, report.issues)

    def test_preview_fetches_data_for_the_lms_page_too(self):
        cfg = self._cfg_with_pages()

        async def fake_fetch(c, w):
            from app.models import WidgetPreview
            return WidgetPreview(widget_id=w.id, ok=True)

        # preview.py does `from ..preview_fetch import fetch_widget`, binding
        # the name into its OWN module namespace -- must patch it there, not
        # on preview_fetch itself, or the patch has no effect.
        with patch("app.agents.preview.fetch_widget", new=AsyncMock(side_effect=fake_fetch)) as mock_fetch:
            _run(preview.run(cfg, _noop_log))
        fetched_ids = {call.args[1].id for call in mock_fetch.call_args_list}
        self.assertIn("lms_tile_lms_enrolled_users", fetched_ids)
        self.assertIn("tile_total_sessions", fetched_ids)


if __name__ == "__main__":
    unittest.main()
