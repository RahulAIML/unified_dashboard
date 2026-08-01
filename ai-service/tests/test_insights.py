"""Regression tests for agents/insights.py — evidence-backed AI insights.

Distinct from dashboard_planning.py's `recommendations` (short suggestions
derived from the SCHEMA, before any real value is fetched): insights run
AFTER preview.run(), reasoning only over data that was ACTUALLY fetched.
Confidence-gated -- with too few real data points, this returns [] rather
than asking an LLM to invent something plausible-sounding. Scoped to
rolplay_app_sql only for this pass.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import insights
from app.models import (
    DashboardConfig,
    DashboardPage,
    DashboardPreview,
    DashboardRow,
    JobPhase,
    ServiceKind,
    WidgetConfig,
    WidgetPreview,
    WidgetType,
)


def _run(coro):
    return asyncio.run(coro)


async def _noop_log(*_args):
    return None


def _cfg(connector=ServiceKind.rolplay_app_sql) -> DashboardConfig:
    widgets = [
        WidgetConfig(id="tile_total_sessions", type=WidgetType.kpi_tile, title="Total Sessions",
                     metric_key="total_sessions", source_kind=connector, source_action="x"),
        WidgetConfig(id="tile_avg_score", type=WidgetType.kpi_tile, title="Average Score",
                     metric_key="avg_score", source_kind=connector, source_action="x"),
    ]
    return DashboardConfig(
        company="Siigo", slug="siigo", title="Siigo Analytics", connector=connector,
        pages=[DashboardPage(id="overview", title="Overview", rows=[DashboardRow(id="r", widgets=widgets)])],
    )


def _preview(values: dict[str, float]) -> DashboardPreview:
    return DashboardPreview(slug="siigo", widgets=[
        WidgetPreview(widget_id=wid, ok=True, value=v) for wid, v in values.items()
    ])


class InsightsScopeTests(unittest.TestCase):
    def test_empty_for_non_rolplay_app_sql_connectors(self):
        cfg = _cfg(connector=ServiceKind.pharma_kpi)
        pv = _preview({"tile_total_sessions": 100, "tile_avg_score": 80})
        result = _run(insights.run(cfg, pv, _noop_log))
        self.assertEqual(result, [])


class InsightsConfidenceGateTests(unittest.TestCase):
    def test_empty_with_fewer_than_two_grounded_facts(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 100})  # only 1 real fact
        with patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=["should never be reached"])):
            result = _run(insights.run(cfg, pv, _noop_log))
        self.assertEqual(result, [])

    def test_empty_when_llm_unavailable(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 100, "tile_avg_score": 80})
        with patch("app.agents.insights.llm_available", return_value=False):
            result = _run(insights.run(cfg, pv, _noop_log))
        self.assertEqual(result, [])

    def test_empty_when_llm_returns_nothing_usable(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 100, "tile_avg_score": 80})
        with patch("app.agents.insights.llm_available", return_value=True), \
             patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=None)):
            result = _run(insights.run(cfg, pv, _noop_log))
        self.assertEqual(result, [])


class InsightsGeneratedTests(unittest.TestCase):
    def test_returns_the_llms_grounded_sentences(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 772, "tile_avg_score": 61.03})
        fake = ["Reps completed 772 sessions with an average score of 61.03."]
        with patch("app.agents.insights.llm_available", return_value=True), \
             patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=fake)) as mock_llm:
            result = _run(insights.run(cfg, pv, _noop_log))
        self.assertEqual(result, fake)
        # The prompt actually carries the real numbers, not a summary shape.
        user_arg = mock_llm.call_args[0][1]
        self.assertIn("772", user_arg)
        self.assertIn("61.03", user_arg)

    def test_ignores_widgets_that_failed_to_fetch(self):
        cfg = _cfg()
        pv = DashboardPreview(slug="siigo", widgets=[
            WidgetPreview(widget_id="tile_total_sessions", ok=True, value=772),
            WidgetPreview(widget_id="tile_avg_score", ok=False, error="no data"),
        ])
        with patch("app.agents.insights.llm_available", return_value=True), \
             patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=["one grounded fact"])) as mock_llm:
            result = _run(insights.run(cfg, pv, _noop_log))
        # Only 1 real fact (avg_score failed) -- below MIN_GROUNDED_WIDGETS, must not call the LLM at all.
        mock_llm.assert_not_called()
        self.assertEqual(result, [])

    def test_caps_at_four_insights(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 772, "tile_avg_score": 61.03})
        fake = [f"insight {i}" for i in range(10)]
        with patch("app.agents.insights.llm_available", return_value=True), \
             patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=fake)):
            result = _run(insights.run(cfg, pv, _noop_log))
        self.assertEqual(len(result), 4)

    def test_non_string_llm_entries_are_dropped(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 772, "tile_avg_score": 61.03})
        with patch("app.agents.insights.llm_available", return_value=True), \
             patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=["real one", 42, None, ""])):
            result = _run(insights.run(cfg, pv, _noop_log))
        self.assertEqual(result, ["real one"])


class LogPhaseValidityTests(unittest.TestCase):
    """Found live: workflow.py's real log() (_mk_log) constructs an actual
    JobPhase(phase) enum value -- a no-op test mock never validates this, so
    insights.py logging with phase="insights" (not a real JobPhase member)
    passed every unit test yet crashed the very first live generation
    ("'insights' is not a valid JobPhase") immediately after a perfectly
    good dashboard had already been built. This uses a REAL phase-validating
    log function, exactly like production, through every branch."""

    def _real_log(self):
        calls = []

        async def log(phase: str, level: str, message: str) -> None:
            JobPhase(phase)  # raises exactly like _mk_log does for an invalid phase
            calls.append((phase, level, message))
        return log, calls

    def test_confidence_gate_branch_logs_a_valid_phase(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 100})  # below MIN_GROUNDED_WIDGETS
        log, calls = self._real_log()
        _run(insights.run(cfg, pv, log))
        self.assertTrue(calls)

    def test_llm_unavailable_branch_logs_a_valid_phase(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 100, "tile_avg_score": 80})
        log, calls = self._real_log()
        with patch("app.agents.insights.llm_available", return_value=False):
            _run(insights.run(cfg, pv, log))
        self.assertTrue(calls)

    def test_llm_returns_nothing_branch_logs_a_valid_phase(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 100, "tile_avg_score": 80})
        log, calls = self._real_log()
        with patch("app.agents.insights.llm_available", return_value=True), \
             patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=None)):
            _run(insights.run(cfg, pv, log))
        self.assertTrue(calls)

    def test_success_branch_logs_a_valid_phase(self):
        cfg = _cfg()
        pv = _preview({"tile_total_sessions": 772, "tile_avg_score": 61.03})
        log, calls = self._real_log()
        with patch("app.agents.insights.llm_available", return_value=True), \
             patch("app.agents.insights.gemini_json", new=AsyncMock(return_value=["a real grounded insight"])):
            result = _run(insights.run(cfg, pv, log))
        self.assertEqual(result, ["a real grounded insight"])
        self.assertTrue(calls)


if __name__ == "__main__":
    unittest.main()
