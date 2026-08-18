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
    _assemble_pages,
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


def _pharma_schema(kind: ServiceKind = ServiceKind.pharma_kpi) -> NormalizedSchema:
    """A non-rolplay_app_sql primary. Its dimension metric's source_kind is what
    gates real per-module page construction in _module_pages."""
    return NormalizedSchema(
        company="Apotex", slug="apotex", modules=[],
        dimensions=["activity"],
        metrics=[
            DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                             source_kind=kind, source_action="kpi.activity_summary"),
            DiscoveredMetric(key="sessions_by_activity", label="Sessions by Activity", type=MetricType.dimension,
                             source_kind=kind, source_action="kpi.activity_summary"),
        ],
    )


class NonRolplayConnectorMandatoryTests(unittest.TestCase):
    """Regression: _module_pages used to `return []` for any non-rolplay_app_sql
    primary BEFORE reaching the contracted-but-missing loop, so a pharma /
    exceltis / coach_app tenant that contracted Simulator, Coach or Certification
    got no page at all -- not even the honest empty stand-in. Real per-module
    pages still require exact module scoping; only the fallback is universal."""

    def test_contracted_modules_get_stand_ins_on_a_pharma_primary(self):
        pages = _module_pages(
            _pharma_schema(), {}, required_services=frozenset({"simulator", "coach"}),
        )
        self.assertEqual({p.id for p in pages}, {"simulator", "coach"})
        self.assertTrue(all(p.mandatory for p in pages))
        self.assertTrue(all(p.rows[0].widgets == [] for p in pages))

    def test_pharma_primary_still_builds_no_real_per_module_pages(self):
        # Nothing contracted -> nothing invented. The scoping restriction that
        # the original early-return enforced must survive this change.
        pages = _module_pages(_pharma_schema(), {}, required_services=frozenset())
        self.assertEqual(pages, [])

    def test_exceltis_primary_behaves_the_same(self):
        pages = _module_pages(
            _pharma_schema(ServiceKind.pharma_exceltis_rest), {},
            required_services=frozenset({"certification"}),
        )
        self.assertEqual({p.id for p in pages}, {"certification"})


class SecondBrainMandatoryTests(unittest.TestCase):
    """Regression: "second-brain" was selectable in the builder but mapped to no
    page id, so mandatory_empty_page returned None and the selection silently did
    nothing at all."""

    def test_contracted_second_brain_gets_a_page_when_no_secondary_exists(self):
        pages = _assemble_pages(
            _rolplay_app_schema(modules=[]), {}, overview_rows=[],
            secondary_schema=None, required_services=frozenset({"second-brain"}),
        )
        sb = [p for p in pages if p.id == "second-brain"]
        self.assertEqual(len(sb), 1, f"expected a Second Brain stand-in, got {[p.id for p in pages]}")
        self.assertTrue(sb[0].mandatory)

    def test_not_contracted_second_brain_stays_absent(self):
        pages = _assemble_pages(
            _rolplay_app_schema(modules=[]), {}, overview_rows=[],
            secondary_schema=None, required_services=frozenset(),
        )
        self.assertNotIn("second-brain", {p.id for p in pages})

    def test_real_secondary_second_brain_page_suppresses_the_stand_in(self):
        # A discovered Second Brain renders as secondary_second_brain; adding the
        # empty stand-in alongside it would duplicate the section.
        secondary = NormalizedSchema(
            company="Salinas", slug="salinas", modules=[], dimensions=[],
            metrics=[
                DiscoveredMetric(key="total_sessions", label="Total Sessions", type=MetricType.count,
                                 source_kind=ServiceKind.second_brain, source_action="profile"),
            ],
        )
        pages = _assemble_pages(
            _rolplay_app_schema(modules=[]), {}, overview_rows=[],
            secondary_schema=secondary, required_services=frozenset({"second-brain"}),
        )
        ids = {p.id for p in pages}
        self.assertIn(f"secondary_{ServiceKind.second_brain.value}", ids)
        self.assertNotIn("second-brain", ids)


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
        self.assertIsNone(mandatory_empty_page("not-a-real-service"))

    def test_second_brain_now_has_a_stand_in_page(self):
        # Regression: this used to return None, so ticking "Second Brain" in the
        # builder silently did nothing -- no page, no empty state, no trace. A
        # contracted service must stay visible even with no data. It is still
        # never synthesized as a per-MODULE page (see the _module_pages test
        # above); the fallback lives in _assemble_pages and only fires when no
        # real secondary Second Brain page was produced.
        page = mandatory_empty_page("second-brain")
        self.assertIsNotNone(page)
        self.assertEqual(page.id, "second-brain")
        self.assertEqual(page.title, "Second Brain")
        self.assertTrue(page.mandatory)
        self.assertEqual(page.rows[0].widgets, [])


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
