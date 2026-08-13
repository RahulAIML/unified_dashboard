"""Regression tests for the "mandatory sections" ticket: a service the
manager explicitly contracted (GenerateRequest.services) must render with an
honest empty state when no data was discovered for it, never silently
disappear from `pages`. Covers the two build-time hooks (_lms_page,
_module_pages) and the post-publish edit path
(dashboard_versions.set_required_sections) that adds/removes a mandatory
stand-in page without a full regenerate.
"""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.dashboard_planning import (
    _lms_page,
    _module_pages,
    mandatory_empty_page,
)
from app.models import (
    DashboardConfig,
    DashboardPage,
    DashboardRow,
    DiscoveredMetric,
    MetricType,
    NormalizedSchema,
    ServiceKind,
    WidgetConfig,
    WidgetType,
)


def _run(coro):
    return asyncio.run(coro)


def _rolplay_app_schema(modules: list[str]) -> NormalizedSchema:
    return NormalizedSchema(
        company="Salinas", slug="salinas", modules=modules,
        dimensions=["activity"],
        metrics=[
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
            DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                             source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session"),
        ],
    )


class LmsPageMandatoryTests(unittest.TestCase):
    def test_no_lms_and_not_required_stays_absent(self):
        self.assertIsNone(_lms_page({}, required_services=frozenset()))

    def test_no_lms_but_contracted_renders_mandatory_empty_page(self):
        page = _lms_page({}, required_services=frozenset({"lms"}))
        self.assertIsNotNone(page)
        self.assertTrue(page.mandatory)
        self.assertEqual(page.id, "lms")
        self.assertEqual(page.rows[0].widgets, [])

    def test_real_lms_data_is_never_marked_mandatory(self):
        metrics = {
            "lms_enrolled_users": DiscoveredMetric(
                key="lms_enrolled_users", label="Enrolled Users", type=MetricType.count,
                source_kind=ServiceKind.pharma_kpi, source_action="lms",
            ),
        }
        page = _lms_page(metrics, required_services=frozenset({"lms"}))
        self.assertIsNotNone(page)
        self.assertFalse(page.mandatory)
        self.assertTrue(page.rows[0].widgets)


class ModulePagesMandatoryTests(unittest.TestCase):
    def test_contracted_but_undiscovered_module_gets_an_empty_mandatory_page(self):
        schema = _rolplay_app_schema(modules=["coach"])  # only "coach" discovered
        pages = _module_pages(schema, {}, required_services=frozenset({"coach", "simulator"}))
        by_id = {p.id: p for p in pages}
        self.assertIn("coach", by_id)
        self.assertFalse(by_id["coach"].mandatory)  # real data -- never marked mandatory
        self.assertIn("simulator", by_id)
        self.assertTrue(by_id["simulator"].mandatory)
        self.assertEqual(by_id["simulator"].rows[0].widgets, [])

    def test_undiscovered_and_not_contracted_module_stays_absent(self):
        schema = _rolplay_app_schema(modules=["coach"])
        pages = _module_pages(schema, {}, required_services=frozenset({"coach"}))
        self.assertEqual({p.id for p in pages}, {"coach"})

    def test_second_brain_is_never_guessed_into_a_module_page(self):
        # "second-brain" has no canonical per-module page (it's a secondary
        # connector's own page) -- must never be synthesized here.
        schema = _rolplay_app_schema(modules=[])
        pages = _module_pages(schema, {}, required_services=frozenset({"second-brain"}))
        self.assertEqual(pages, [])


class MandatoryEmptyPageHelperTests(unittest.TestCase):
    def test_known_service_produces_a_labeled_empty_page(self):
        page = mandatory_empty_page("simulator")
        self.assertEqual(page.title, "Practice Simulator")
        self.assertTrue(page.mandatory)
        self.assertEqual(page.rows[0].widgets, [])

    def test_unknown_service_returns_none(self):
        self.assertIsNone(mandatory_empty_page("second-brain"))
        self.assertIsNone(mandatory_empty_page("not-a-real-service"))


class _FakePool:
    def __init__(self, config: DashboardConfig):
        self.stored = config.model_dump_json()
        self.updates: list[str] = []

    async def fetchrow(self, sql, *params):
        if "SELECT config FROM dashboard_metadata" in sql:
            return {"config": self.stored}
        return None

    async def execute(self, sql, *params):
        if "UPDATE dashboard_metadata SET config" in sql:
            _slug, new_config = params
            self.stored = new_config
            self.updates.append(new_config)


class SetRequiredSectionsTests(unittest.TestCase):
    def _cfg(self):
        return DashboardConfig(
            company="Salinas", slug="salinas", title="Salinas Analytics",
            connector=ServiceKind.rolplay_app_sql,
            pages=[DashboardPage(id="overview", title="Overview", rows=[
                DashboardRow(id="r1", widgets=[WidgetConfig(
                    id="tile_total_sessions", type=WidgetType.kpi_tile, title="Total Sessions",
                    source_kind=ServiceKind.rolplay_app_sql, source_action="r_user_session",
                )]),
            ])],
        )

    def test_adds_a_mandatory_empty_page_for_a_newly_required_service_with_no_rebuild(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_required_sections("salinas", ["lms"]))

        self.assertIsNotNone(result)
        self.assertEqual(result.required_sections, ["lms"])
        page_ids = {p.id for p in result.pages}
        self.assertIn("lms", page_ids)
        lms_page = next(p for p in result.pages if p.id == "lms")
        self.assertTrue(lms_page.mandatory)
        # Overview (real data, untouched) still there too.
        self.assertIn("overview", page_ids)

    def test_removing_a_still_empty_required_service_drops_its_stand_in_page(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            _run(dashboard_versions.set_required_sections("salinas", ["lms"]))
            result = _run(dashboard_versions.set_required_sections("salinas", []))

        self.assertEqual(result.required_sections, [])
        self.assertNotIn("lms", {p.id for p in result.pages})

    def test_returns_none_for_an_unknown_slug(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        pool.fetchrow = AsyncMock(return_value=None)
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_required_sections("does-not-exist", ["lms"]))
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
